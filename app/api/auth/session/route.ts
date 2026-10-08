/**
 * POST /api/auth/session
 *
 * Exchanges a Firebase ID token for an httpOnly session cookie.
 *
 * Called by the browser:
 *  - immediately after sign-in,
 *  - on every Firebase `onIdTokenChanged` event, which keeps the cookie fresh
 *    without any polling and without any AI cost.
 *
 * DELETE revokes the session server-side when possible, then clears the cookie.
 */

import { cookies } from "next/headers";

import { getAdminAuth } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  idTokenMaxAgeSeconds,
  sessionCookieOptions,
  verifyToken,
} from "@/lib/auth/session";
import { identityFromRequest, RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { jsonError, jsonFromError, jsonOk, readJsonBody, NO_STORE } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SessionRequestBody {
  idToken?: string;
}

export async function POST(request: Request) {
  try {
    const limiter = rateLimit({
      identity: identityFromRequest(request, null),
      rule: RATE_LIMITS.session,
      scope: "session",
    });
    if (!limiter.allowed) {
      return jsonError("RATE_LIMITED", "Too many sign-in attempts. Please wait a moment.", 429, true);
    }

    const body = await readJsonBody<SessionRequestBody>(request, 8 * 1024);
    const idToken = body.idToken?.trim();

    if (!idToken || idToken.length < 20) {
      return jsonError("UNAUTHENTICATED", "A valid sign-in token is required.", 401, false);
    }

    const user = await verifyToken(idToken);
    if (!user) {
      return jsonError("UNAUTHENTICATED", "That sign-in token could not be verified.", 401, false);
    }

    // Prefer a long-lived Firebase session cookie. Fall back to the ID token
    // itself (1 hour) when no service account is configured.
    let cookieValue = idToken;
    let maxAge = idTokenMaxAgeSeconds();
    const admin = getAdminAuth();

    if (admin) {
      try {
        cookieValue = await admin.createSessionCookie(idToken, {
          expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
        });
        maxAge = SESSION_MAX_AGE_SECONDS;
      } catch {
        // Keep the ID token. It still authenticates every request.
      }
    }

    const store = await cookies();
    store.set(SESSION_COOKIE, cookieValue, sessionCookieOptions(maxAge));

    // The profile document is created by the browser through the client SDK,
    // where the rules prove ownership from the signed-in uid. This route only
    // establishes the session; it never writes to Firestore.

    return jsonOk(
      {
        ok: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        },
        expiresInSeconds: maxAge,
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    return jsonFromError(error);
  }
}

export async function DELETE() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    // Revoking refresh tokens requires an Admin credential. Without one the
    // cookie is cleared and the browser's Firebase session ends, but the
    // provider-side refresh token is left alone until it expires.
    if (token) {
      const user = await verifyToken(token);
      const admin = getAdminAuth();
      if (user && admin) {
        await admin.revokeRefreshTokens(user.uid).catch(() => undefined);
      }
    }

    store.delete(SESSION_COOKIE);
    return jsonOk({ ok: true }, 200, NO_STORE);
  } catch (error) {
    return jsonFromError(error);
  }
}