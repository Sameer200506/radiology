import "server-only";

import { cookies } from "next/headers";

import { AiError } from "@/lib/ai/provider-core";
import { getAiRequestContext, setAiConnection } from "@/lib/ai/context";
import {
  CHATGPT_PLAN_SCOPE,
  type ChatGptConnection,
  type ChatGptConnectionSummary,
} from "@/lib/ai/chatgpt-types";
import {
  refreshAccessToken,
  grantedScopes,
  hasPlanUsageScope,
  type ChatGptTokenResponse,
} from "@/lib/ai/chatgpt-oauth";
import { ConnectionCryptoError, decryptJson, encryptJson } from "@/lib/ai/connection-crypto";

const COOKIE_PREFIX = "medassist_chatgpt_";
const MAX_CHUNKS = 8;
const CHUNK_CHARS = 3_600;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieName(index: number): string {
  return `${COOKIE_PREFIX}${index}`;
}

function cookieAad(uid: string): string {
  return `medassist-chatgpt-cookie:${uid}`;
}

function isValidConnection(value: unknown, uid: string): value is ChatGptConnection {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ChatGptConnection>;
  return (
    record.version === 1 &&
    record.uid === uid &&
    typeof record.clientId === "string" &&
    record.clientId.length > 0 &&
    typeof record.accessToken === "string" &&
    record.accessToken.length > 0 &&
    typeof record.refreshToken === "string" &&
    record.refreshToken.length > 0 &&
    typeof record.expiresAt === "number" &&
    Array.isArray(record.grantedScopes)
  );
}

/**
 * Reads the connection for a specific Firebase user.
 *
 * The cookie is encrypted with the uid as associated data, so copying it to
 * another account (or a different browser session) does not decrypt into a
 * usable connection.
 */
export async function readChatGptConnection(uid: string): Promise<ChatGptConnection | null> {
  const store = await cookies();
  let token = "";

  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    const part = store.get(cookieName(index))?.value;
    if (!part) break;
    token += part;
  }

  if (!token) return null;

  const record = decryptJson<ChatGptConnection>(token, cookieAad(uid));
  if (!isValidConnection(record, uid)) return null;
  return record;
}

export async function writeChatGptConnection(
  connection: ChatGptConnection,
  secure: boolean,
): Promise<void> {
  const token = encryptJson(connection, cookieAad(connection.uid));
  const chunks: string[] = [];

  for (let offset = 0; offset < token.length; offset += CHUNK_CHARS) {
    chunks.push(token.slice(offset, offset + CHUNK_CHARS));
  }

  if (chunks.length > MAX_CHUNKS) {
    throw new ConnectionCryptoError(
      "The ChatGPT connection is too large to store. Disconnect and reconnect the account.",
    );
  }

  const store = await cookies();
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };

  chunks.forEach((chunk, index) => {
    store.set(cookieName(index), chunk, options);
  });

  // A previous connection may have had more chunks. Clearing the tail avoids a
  // stale fragment being appended to the next read.
  for (let index = chunks.length; index < MAX_CHUNKS; index += 1) {
    store.delete(cookieName(index));
  }
}

export async function clearChatGptConnection(): Promise<void> {
  const store = await cookies();
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    store.delete(cookieName(index));
  }
}

const refreshes = new Map<string, Promise<ChatGptConnection>>();

/**
 * Refresh failures that mean the token set is dead. OpenAI documents these as
 * requiring a fresh OAuth run; retrying or keeping the cookie only delays the
 * inevitable. `invalid_client` is deliberately separate: it is a deployment
 * configuration problem, not a revoked user token.
 */
const TERMINAL_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

function connectionFromTokens(
  current: ChatGptConnection,
  tokens: ChatGptTokenResponse,
): ChatGptConnection {
  const granted = grantedScopes(tokens.scope);
  const scopes = granted.length > 0 ? granted : current.grantedScopes;

  return {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || current.refreshToken,
    tokenType: tokens.token_type || current.tokenType,
    grantedScopes: scopes,
    // When the response carries scopes, they are authoritative. An omitted
    // scope field preserves the previous grant.
    planUsage: granted.length > 0 ? hasPlanUsageScope(granted) : current.planUsage,
    expiresAt: Date.now() + Math.max(60, tokens.expires_in) * 1_000,
  };
}

/**
 * Returns a usable access token, refreshing it when it is within a minute of
 * expiry. Refreshes are serialised per process so two stages in the same
 * assessment cannot race a rotating refresh token.
 */
export async function getChatGptAccessToken(
  connection: ChatGptConnection,
): Promise<ChatGptConnection> {
  if (Date.now() < connection.expiresAt - 60_000) return connection;

  const existing = refreshes.get(connection.uid);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const tokens = await refreshAccessToken({
        clientId: connection.clientId,
        refreshToken: connection.refreshToken,
      });

      const updated = connectionFromTokens(connection, tokens);
      setAiConnection(updated);

      try {
        const secure = getAiRequestContext()?.secure ?? process.env.NODE_ENV === "production";
        await writeChatGptConnection(updated, secure);
      } catch (error) {
        // The refreshed token remains usable for this request through the
        // context. A failed cookie write only means the next request may need to
        // refresh again; it must not fail the medical analysis.
        console.warn(
          "[chatgpt] could not persist refreshed tokens:",
          error instanceof Error ? error.message : "unknown error",
        );
      }

      return updated;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";

      if (TERMINAL_REFRESH_CODES.has(code)) {
        setAiConnection(null);
        await clearChatGptConnection().catch(() => undefined);
        throw new AiError({
          code: "AI_CONNECTION_REQUIRED",
          message:
            "Your ChatGPT connection has expired or was revoked. Reconnect your ChatGPT account in Settings, or disconnect it to use the deployment's AI.",
          status: 401,
          retryable: false,
          internalDetail: `ChatGPT refresh failed: ${code}`,
        });
      }

      if (code === "invalid_client") {
        throw new AiError({
          code: "AI_NOT_CONFIGURED",
          message:
            "ChatGPT sign-in is misconfigured on this deployment. Please contact the administrator of this application.",
          status: 503,
          retryable: false,
          internalDetail: "ChatGPT refresh failed: invalid_client",
        });
      }

      throw new AiError({
        code: "AI_PROVIDER_ERROR",
        message:
          "Could not renew the ChatGPT session just now. Please try again in a moment.",
        status: 503,
        retryable: true,
        internalDetail:
          error instanceof Error ? error.message : "unknown ChatGPT refresh failure",
      });
    }
  })();

  refreshes.set(connection.uid, pending);
  try {
    return await pending;
  } finally {
    refreshes.delete(connection.uid);
  }
}

export function summariseChatGptConnection(
  connection: ChatGptConnection,
): ChatGptConnectionSummary {
  return {
    connected: true,
    email: connection.email,
    name: connection.name,
    planUsage: connection.planUsage,
    model: connection.model ?? "",
    visionModel: connection.visionModel,
    connectedAt: new Date(connection.connectedAt).toISOString(),
    expiresAt: new Date(connection.expiresAt).toISOString(),
  };
}

export function planUsageGranted(scopes: string[]): boolean {
  return scopes.includes(CHATGPT_PLAN_SCOPE);
}
