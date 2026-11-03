/**
 * GET /api/ai/connection/chatgpt/start
 *
 * Starts Sign in with ChatGPT using OAuth 2.0 Authorization Code + PKCE.
 *
 * The transaction is carried in an encrypted, short-lived `state` value rather
 * than a cookie. That is what lets the open-source flow use its required
 * `127.0.0.1` callback even when the app was opened at `localhost`: the callback
 * can decrypt the state and knows which Firebase user and app origin to return
 * to without sharing cookies across hosts.
 */

import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { readChatGptConnection } from "@/lib/ai/chatgpt-connection";
import {
  buildAuthorizationUrl,
  encodeOAuthState,
  resolveChatGptOAuthConfig,
} from "@/lib/ai/chatgpt-oauth";
import { settingsRedirect } from "@/lib/ai/chatgpt-redirect";
import { guardedRoute } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_NAME = "MedAssist AI";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async ({ user, request: req }) => {
    const config = resolveChatGptOAuthConfig(req);

    if (!config.available) {
      return settingsRedirect(
        config.appOrigin,
        "unavailable",
        config.reason ? "not_configured" : undefined,
      );
    }

    const existing = await readChatGptConnection(user.uid).catch(() => null);

    // A returning account must reauthorize the client id it was issued during
    // dynamic registration. `dynamic_agent_client` is an entrypoint, not a
    // client id to save or reuse.
    const clientId = existing?.clientId ?? config.clientId;
    const dynamic = !existing && config.dynamic;
    const redirectUri = config.redirectUri;

    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const nonce = randomBytes(24).toString("base64url");

    const state = encodeOAuthState({
      uid: user.uid,
      appOrigin: config.appOrigin,
      redirectUri,
      clientId,
      dynamic,
      agentHostId: config.agentHostId,
      nonce,
      codeVerifier,
      createdAt: Date.now(),
    });

    const authorizeUrl = buildAuthorizationUrl({
      clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge,
      dynamic,
      agentHostId: config.agentHostId,
      agentName: AGENT_NAME,
      loginHint: existing?.email ?? null,
    });

    return NextResponse.redirect(authorizeUrl);
  })(request);
}
