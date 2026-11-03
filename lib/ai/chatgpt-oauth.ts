import "server-only";

import { createHash } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  CHATGPT_PLAN_SCOPE,
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  type ChatGptModel,
  type ChatGptOAuthState,
} from "@/lib/ai/chatgpt-types";
import {
  connectionCryptoUnavailableReason,
  encryptJson,
  decryptJson,
  isConnectionCryptoAvailable,
} from "@/lib/ai/connection-crypto";

export const OPENAI_ISSUER = "https://auth.openai.com";
export const OPENAI_AUTHORIZE_ENDPOINT = `${OPENAI_ISSUER}/api/accounts/authorize`;
export const OPENAI_TOKEN_ENDPOINT = `${OPENAI_ISSUER}/api/accounts/oauth/token`;
export const OPENAI_REVOCATION_ENDPOINT = `${OPENAI_ISSUER}/api/accounts/oauth/revoke`;
export const OPENAI_JWKS_URI = `${OPENAI_ISSUER}/.well-known/jwks.json`;
export const OPENAI_API_BASE = "https://api.openai.com/v1";
export const DYNAMIC_AGENT_CLIENT_ID = "dynamic_agent_client";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_AAD = "medassist-chatgpt-oauth-state";
const jwks = createRemoteJWKSet(new URL(OPENAI_JWKS_URI));

export class ChatGptOAuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(params: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = "ChatGptOAuthError";
    this.code = params.code;
    this.status = params.status ?? 502;
    this.retryable = params.retryable ?? false;
  }
}

export interface ChatGptOAuthConfig {
  available: boolean;
  reason: string | null;
  appOrigin: string;
  clientId: string;
  redirectUri: string;
  /** True when this is the first-time `dynamic_agent_client` registration. */
  dynamic: boolean;
  agentHostId: string;
}

/**
 * A stable host identifier for this deployment.
 *
 * The docs prefer a JWK thumbprint or a persisted UUID. We do not have a
 * writable host store, so the deployment origin is hashed into a UUIDv4-shaped
 * value. It is opaque, stable across restarts, and never identifies a person.
 */
export function agentHostIdFor(origin: string): string {
  const configured = process.env.OPENAI_AGENT_HOST_ID?.trim();
  if (configured) return configured;

  const hex = createHash("sha256").update(`medassist-ai:${origin}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveChatGptOAuthConfig(request: Request): ChatGptOAuthConfig {
  const requestOrigin = new URL(request.url).origin;
  const appOrigin =
    normaliseOrigin(process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "") ?? requestOrigin;
  const agentHostId = agentHostIdFor(appOrigin);

  if (!isConnectionCryptoAvailable()) {
    return {
      available: false,
      reason:
        connectionCryptoUnavailableReason() ??
        "This deployment cannot protect a ChatGPT connection.",
      appOrigin,
      clientId: DYNAMIC_AGENT_CLIENT_ID,
      redirectUri: `${appOrigin}/api/ai/connection/chatgpt/callback`,
      dynamic: false,
      agentHostId,
    };
  }

  const registeredClientId = process.env.OPENAI_SIWC_CLIENT_ID?.trim();

  if (registeredClientId) {
    return {
      available: true,
      reason: null,
      appOrigin,
      clientId: registeredClientId,
      redirectUri:
        process.env.OPENAI_SIWC_REDIRECT_URI?.trim() ||
        `${appOrigin}/api/ai/connection/chatgpt/callback`,
      dynamic: false,
      agentHostId,
    };
  }

  const appUrl = new URL(appOrigin);
  if (!isLoopbackHost(appUrl.hostname) || appUrl.protocol !== "http:") {
    return {
      available: false,
      reason:
        "ChatGPT plan connection needs an approved OpenAI client ID on a hosted deployment. Set OPENAI_SIWC_CLIENT_ID and OPENAI_SIWC_REDIRECT_URI, or run the app locally at http://127.0.0.1:3000.",
      appOrigin,
      clientId: DYNAMIC_AGENT_CLIENT_ID,
      redirectUri: `${appOrigin}/api/ai/connection/chatgpt/callback`,
      dynamic: true,
      agentHostId,
    };
  }

  // The open-source registration flow requires an HTTP loopback callback whose
  // host is literally 127.0.0.1 (not localhost), and only the port may vary.
  const port = appUrl.port || "80";
  return {
    available: true,
    reason: null,
    appOrigin,
    clientId: DYNAMIC_AGENT_CLIENT_ID,
    redirectUri: `http://127.0.0.1:${port}/api/ai/connection/chatgpt/callback`,
    dynamic: true,
    agentHostId,
  };
}

/* ------------------------------------------------------------------ *
 * OAuth state
 * ------------------------------------------------------------------ */

export function encodeOAuthState(state: ChatGptOAuthState): string {
  return encryptJson(state, OAUTH_STATE_AAD);
}

export function decodeOAuthState(value: string): ChatGptOAuthState | null {
  const state = decryptJson<ChatGptOAuthState>(value, OAUTH_STATE_AAD);
  if (!state) return null;
  if (
    typeof state.uid !== "string" ||
    typeof state.appOrigin !== "string" ||
    typeof state.redirectUri !== "string" ||
    typeof state.clientId !== "string" ||
    typeof state.nonce !== "string" ||
    typeof state.codeVerifier !== "string" ||
    typeof state.createdAt !== "number" ||
    Date.now() - state.createdAt > OAUTH_STATE_TTL_MS
  ) {
    return null;
  }
  return state;
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  dynamic: boolean;
  agentHostId: string;
  agentName?: string;
  loginHint?: string | null;
}): URL {
  const url = new URL(OPENAI_AUTHORIZE_ENDPOINT);
  const params = url.searchParams;

  params.set("client_id", input.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("response_type", "code");
  params.set("scope", CHATGPT_SCOPES.join(" "));
  params.set("resource", CHATGPT_RESOURCE);
  params.set("state", input.state);
  params.set("nonce", input.nonce);
  params.set("code_challenge_method", "S256");
  params.set("code_challenge", input.codeChallenge);
  params.set("ext_agent_host_id", input.agentHostId);

  if (input.dynamic && input.agentName) {
    params.set("agent_name_hint", input.agentName);
  }
  if (input.loginHint) {
    params.set("login_hint", input.loginHint);
  }

  return url;
}

/* ------------------------------------------------------------------ *
 * Token endpoint
 * ------------------------------------------------------------------ */

export interface ChatGptTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string | null;
  token_type: string;
  expires_in: number;
  scope: string | null;
}

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function readTokenResponse(response: Response): Promise<RawTokenResponse> {
  const text = await response.text();
  let payload: RawTokenResponse | null = null;
  try {
    payload = text ? (JSON.parse(text) as RawTokenResponse) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = typeof payload?.error === "string" ? payload.error : `http_${response.status}`;
    throw new ChatGptOAuthError({
      code,
      message:
        typeof payload?.error_description === "string"
          ? payload.error_description.slice(0, 300)
          : `OpenAI token request failed (${response.status}).`,
      status: response.status >= 500 ? 502 : 400,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  if (!payload || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
    throw new ChatGptOAuthError({
      code: "invalid_token_response",
      message: "OpenAI did not return the expected tokens.",
    });
  }

  return payload;
}

function toTokenResponse(payload: RawTokenResponse): ChatGptTokenResponse {
  return {
    access_token: String(payload.access_token),
    refresh_token: String(payload.refresh_token),
    id_token: typeof payload.id_token === "string" ? payload.id_token : null,
    token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    expires_in:
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? payload.expires_in
        : 3600,
    scope: typeof payload.scope === "string" ? payload.scope : null,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<ChatGptTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    resource: CHATGPT_RESOURCE,
  });

  const response = await fetch(OPENAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  return toTokenResponse(await readTokenResponse(response));
}

export async function refreshAccessToken(input: {
  clientId: string;
  refreshToken: string;
}): Promise<ChatGptTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    resource: CHATGPT_RESOURCE,
  });

  const response = await fetch(OPENAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  return toTokenResponse(await readTokenResponse(response));
}

export async function revokeRefreshToken(input: {
  clientId: string;
  refreshToken: string;
}): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      token: input.refreshToken,
      token_type_hint: "refresh_token",
      client_id: input.clientId,
    });

    const response = await fetch(OPENAI_REVOCATION_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * ID token
 * ------------------------------------------------------------------ */

export interface VerifiedChatGptIdentity {
  subject: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  nonce: string | null;
}

export async function verifyChatGptIdToken(input: {
  idToken: string;
  clientId: string;
  expectedNonce: string;
}): Promise<VerifiedChatGptIdentity> {
  const { payload } = await jwtVerify(input.idToken, jwks, {
    issuer: OPENAI_ISSUER,
    audience: input.clientId,
    clockTolerance: 60,
    requiredClaims: ["sub", "iat", "exp"],
  });

  if (payload.nonce !== input.expectedNonce) {
    throw new ChatGptOAuthError({
      code: "nonce_mismatch",
      message: "The ChatGPT sign-in response did not match this sign-in attempt.",
      status: 400,
    });
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new ChatGptOAuthError({
      code: "missing_subject",
      message: "The ChatGPT sign-in response did not identify an account.",
      status: 400,
    });
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    emailVerified: payload.email_verified === true,
    nonce: typeof payload.nonce === "string" ? payload.nonce : null,
  };
}

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

export function grantedScopes(scope: string | null): string[] {
  return scope ? scope.split(/\s+/).filter(Boolean) : [];
}

export function hasPlanUsageScope(scopes: string[]): boolean {
  return scopes.includes(CHATGPT_PLAN_SCOPE);
}

interface RawModel {
  slug?: unknown;
  id?: unknown;
  display_name?: unknown;
  visibility?: unknown;
}

export async function listChatGptModels(accessToken: string): Promise<ChatGptModel[]> {
  const response = await fetch(`${OPENAI_API_BASE}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new ChatGptOAuthError({
      code: "models_failed",
      message: `Could not list ChatGPT models (${response.status}).`,
      status: response.status >= 500 ? 502 : 400,
      retryable: response.status >= 500,
    });
  }

  const payload = (await response.json()) as {
    models?: RawModel[];
    data?: RawModel[];
  };

  const raw = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.data)
      ? payload.data
      : [];

  const seen = new Set<string>();
  const models: ChatGptModel[] = [];

  for (const item of raw) {
    const id =
      typeof item.slug === "string"
        ? item.slug
        : typeof item.id === "string"
          ? item.id
          : null;
    if (!id || seen.has(id)) continue;

    const visibility = typeof item.visibility === "string" ? item.visibility : null;
    if (visibility && visibility !== "list") continue;

    seen.add(id);
    models.push({
      id,
      label: typeof item.display_name === "string" ? item.display_name : id,
    });
  }

  return models;
}

const NON_CHAT_MARKERS = [
  "embedding",
  "tts",
  "whisper",
  "transcribe",
  "dall-e",
  "image",
  "moderation",
  "realtime",
];

/**
 * Picks a sensible default model from the account-specific catalogue.
 *
 * We cannot hardcode one: ChatGPT plan models change and availability differs by
 * plan. The score only expresses a preference for a general chat/reasoning model
 * and never claims a capability the catalogue did not advertise.
 */
export function pickChatGptModel(models: ChatGptModel[]): ChatGptModel | null {
  let best: { model: ChatGptModel; score: number } | null = null;

  for (const model of models) {
    const id = model.id.toLowerCase();
    if (NON_CHAT_MARKERS.some((marker) => id.includes(marker))) continue;

    let score = 0;
    if (id.includes("sol")) score += 50;
    if (id.includes("codex")) score += 40;
    if (id.includes("gpt-6")) score += 35;
    if (id.includes("gpt-5")) score += 30;
    if (id.includes("gpt")) score += 20;
    if (id.includes("pro")) score += 5;
    if (id.includes("mini")) score -= 5;
    if (id.includes("nano")) score -= 10;

    if (!best || score > best.score) best = { model, score };
  }

  return best?.model ?? null;
}
