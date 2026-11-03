/**
 * GET /api/ai/connection/chatgpt/callback
 *
 * OpenAI redirects here after the user approves (or declines) the connection.
 *
 * This route is intentionally not guarded by the Firebase session: the
 * open-source flow's callback host is `127.0.0.1`, which is a different cookie
 * origin from `localhost`. The encrypted `state` carries the Firebase uid and
 * the app origin, so the callback can verify who started the flow without
 * trusting a cross-origin cookie. If the callback is on a different host, the
 * sealed connection is left in a single-use hand-off and completed on the app
 * origin, where the session cookie exists.
 */

import { NextResponse } from "next/server";

import {
  readChatGptConnection,
  writeChatGptConnection,
} from "@/lib/ai/chatgpt-connection";
import { putConnectionHandoff } from "@/lib/ai/chatgpt-handoff";
import {
  DYNAMIC_AGENT_CLIENT_ID,
  decodeOAuthState,
  exchangeAuthorizationCode,
  grantedScopes,
  hasPlanUsageScope,
  listChatGptModels,
  normaliseOrigin,
  pickChatGptModel,
  revokeRefreshToken,
  verifyChatGptIdToken,
} from "@/lib/ai/chatgpt-oauth";
import { settingsRedirect } from "@/lib/ai/chatgpt-redirect";
import { DEFAULT_CHATGPT_MODEL } from "@/lib/ai/models";
import { getSessionUser, isSecureRequest } from "@/lib/auth/session";
import { identityFromRequest, RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";
import type { ChatGptConnection } from "@/lib/ai/chatgpt-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fallbackOrigin(request: Request): string {
  return (
    normaliseOrigin(process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "") ??
    new URL(request.url).origin
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const limiter = rateLimit({
    identity: identityFromRequest(request, null),
    rule: RATE_LIMITS.session,
    scope: "chatgpt-oauth",
  });
  if (!limiter.allowed) {
    return settingsRedirect(fallbackOrigin(request), "error", "rate_limited");
  }

  const state = decodeOAuthState(url.searchParams.get("state") ?? "");
  if (!state) {
    return settingsRedirect(fallbackOrigin(request), "error", "state_invalid");
  }

  const appOrigin = normaliseOrigin(state.appOrigin) ?? fallbackOrigin(request);

  if (url.searchParams.has("error")) {
    const error = url.searchParams.get("error");
    return settingsRedirect(
      appOrigin,
      error === "access_denied" ? "denied" : "error",
      error === "access_denied" ? "access_denied" : "oauth_error",
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return settingsRedirect(appOrigin, "error", "missing_code");
  }

  const callbackClientId = url.searchParams.get("client_id");
  let issuedClientId = state.clientId;

  if (state.dynamic) {
    // A new dynamic registration must return its issued client id. The
    // entrypoint id `dynamic_agent_client` is never saved or exchanged.
    if (!callbackClientId || callbackClientId === DYNAMIC_AGENT_CLIENT_ID) {
      return settingsRedirect(appOrigin, "error", "registration_incomplete");
    }
    issuedClientId = callbackClientId;
  } else if (callbackClientId && callbackClientId !== state.clientId) {
    return settingsRedirect(appOrigin, "error", "client_mismatch");
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: state.codeVerifier,
      redirectUri: state.redirectUri,
      clientId: issuedClientId,
    });
  } catch (error) {
    console.error(
      "[chatgpt-oauth] code exchange failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    const codeName =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    return settingsRedirect(
      appOrigin,
      "error",
      codeName === "invalid_grant" ? "code_expired" : "exchange_failed",
    );
  }

  if (!tokens.id_token) {
    return settingsRedirect(appOrigin, "error", "no_identity");
  }

  let identity;
  try {
    identity = await verifyChatGptIdToken({
      idToken: tokens.id_token,
      clientId: issuedClientId,
      expectedNonce: state.nonce,
    });
  } catch (error) {
    console.error(
      "[chatgpt-oauth] identity verification failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return settingsRedirect(appOrigin, "error", "verification_failed");
  }

  const scopes = grantedScopes(tokens.scope);
  if (!hasPlanUsageScope(scopes)) {
    // A valid identity without the plan scope cannot power this app's AI. Do not
    // silently fall back to the deployment key: tell the user to approve usage.
    return settingsRedirect(appOrigin, "plan_not_granted");
  }

  // The catalogue is account-specific; use it to choose a model that exists for
  // this user. A failure is not fatal: CHATGPT_MODEL or the documented default
  // still gives the pipeline a model id.
  const models = await listChatGptModels(tokens.access_token).catch(() => []);
  const model =
    process.env.CHATGPT_MODEL?.trim() ||
    pickChatGptModel(models)?.id ||
    DEFAULT_CHATGPT_MODEL;

  const connection: ChatGptConnection = {
    version: 1,
    uid: state.uid,
    clientId: issuedClientId,
    agentHostId: state.agentHostId,
    subject: identity.subject,
    email: identity.email,
    name: identity.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    grantedScopes: scopes,
    planUsage: true,
    expiresAt: Date.now() + Math.max(60, tokens.expires_in) * 1_000,
    connectedAt: Date.now(),
    model,
    visionModel: process.env.CHATGPT_VISION_MODEL?.trim() || null,
  };

  // Same-origin callbacks (registered HTTPS client) can write the cookie
  // directly. The loopback callback cannot set a cookie for localhost, so it
  // hands the sealed record to the app origin instead.
  if (appOrigin === url.origin) {
    const session = await getSessionUser().catch(() => null);
    if (session?.uid === connection.uid) {
      const previous = await readChatGptConnection(connection.uid).catch(() => null);
      if (previous && previous.refreshToken !== connection.refreshToken) {
        await revokeRefreshToken({
          clientId: previous.clientId,
          refreshToken: previous.refreshToken,
        }).catch(() => undefined);
      }

      await writeChatGptConnection(connection, isSecureRequest(request));
      return settingsRedirect(appOrigin, "connected");
    }
  }

  const handoff = putConnectionHandoff(connection);
  const completeUrl = new URL("/api/ai/connection/chatgpt/complete", appOrigin);
  completeUrl.searchParams.set("handoff", handoff);
  return NextResponse.redirect(completeUrl);
}
