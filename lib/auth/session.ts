/**
 * Session handling.
 *
 * Flow:
 *  1. The browser signs in with Firebase Auth (popup or password) and holds the
 *     Firebase ID token in memory. The token is never put in localStorage.
 *  2. The browser POSTs that ID token to /api/auth/session. The server verifies
 *     it and sets an httpOnly, Secure, SameSite=Lax cookie.
 *  3. Server Components, Route Handlers and proxy.ts read only that cookie.
 *
 * With Admin credentials present the server mints a 5-day Firebase session
 * cookie. Without them it falls back to storing the 1-hour ID token itself and
 * verifying it through Google's token lookup endpoint, which needs no service
 * account. The client re-POSTs on every Firebase token change, so the cookie
 * stays fresh either way.
 */

import "server-only";

import { cookies } from "next/headers";

import { getAdminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE = "medassist_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;
const ID_TOKEN_MAX_AGE_SECONDS = 60 * 55;

export interface SessionUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  /** True when the token was revoked, so the client should sign out. */
  revoked?: boolean;
}

/** Decoded claims we rely on. */
interface Claims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp?: number;
  iat?: number;
  error?: string;
}

/**
 * Verify an ID or session token using Google, without a service account.
 *
 * Used as the fallback when the Admin SDK is unavailable. Requires only the
 * publishable API key and project id, both of which are public by design.
 */
async function verifyTokenViaRest(idToken: string): Promise<SessionUser | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return null;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    // 400 means the token is invalid or expired. Anything else is an outage.
    return null;
  }

  const payload = (await response.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
      photoUrl?: string;
    }>;
  };

  const user = payload.users?.[0];
  if (!user?.localId) return null;

  return {
    uid: user.localId,
    email: user.email ?? null,
    emailVerified: user.emailVerified ?? false,
    displayName: user.displayName ?? null,
    photoURL: user.photoUrl ?? null,
  };
}

function claimsToUser(claims: Claims): SessionUser | null {
  if (!claims.sub) return null;
  return {
    uid: claims.sub,
    email: claims.email ?? null,
    emailVerified: claims.email_verified ?? false,
    displayName: claims.name ?? null,
    photoURL: claims.picture ?? null,
  };
}

function decodeJwtPayload(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1] as string, "base64url").toString("utf8");
    return JSON.parse(json) as Claims;
  } catch {
    return null;
  }
}

/** Verify a token, preferring the Admin SDK and falling back to REST. */
export async function verifyToken(token: string): Promise<SessionUser | null> {
  if (!token || token.length < 20) return null;

  const admin = getAdminAuth();
  if (admin) {
    try {
      // verifySessionCookie also accepts ID tokens, so one call covers both modes.
      const decoded = await admin.verifySessionCookie(token, true);
      const user = claimsToUser(decoded as Claims);
      if (user) return user;
    } catch {
      // fall through to id-token verification, then REST
    }

    try {
      const decoded = await admin.verifyIdToken(token, true);
      const user = claimsToUser(decoded as Claims);
      if (user) return user;
    } catch {
      // fall through
    }
  }

  return verifyTokenViaRest(token);
}

/** Read and verify the session cookie for the current request. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Cheap local expiry check before spending a network round trip.
  const claims = decodeJwtPayload(token);
  if (claims?.exp && claims.exp * 1000 <= Date.now()) return null;

  return verifyToken(token);
}

/**
 * Returns the session user, or null. Use with a redirect when the route is
 * protected.
 */
export async function requireSessionUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Exposed so the session route can choose an age without duplicating the value. */
export function idTokenMaxAgeSeconds(): number {
  return ID_TOKEN_MAX_AGE_SECONDS;
}