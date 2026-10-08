/**
 * Next.js Proxy (the Next 16 successor to middleware).
 *
 * Purpose is USER EXPERIENCE ONLY: bounce signed-out visitors away from
 * protected pages before a server component renders.
 *
 * It is deliberately NOT the security boundary. Proxy performs a cheap
 * structural check on the session cookie — present, well-formed, unexpired,
 * correct issuer and audience. Cryptographic verification happens in
 * `getSessionUser()` on every request that actually touches data, and Firestore
 * Security Rules are the real control. A user who forges a cookie still cannot
 * read or write anything.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  isAuthPage,
  isProtectedPath,
  normalizePath,
  safeRedirectTarget,
} from "@/lib/security/access";

const SESSION_COOKIE = "medassist_session";

interface TokenClaims {
  sub?: string;
  exp?: number;
  aud?: string | string[];
  iss?: string;
}

/** Base64url decode without relying on Buffer availability. */
function decodeSegment(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    if (typeof atob === "function") {
      const binary = atob(padded);
      // Re-decode as UTF-8.
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function readClaims(token: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeSegment(parts[1] as string);
  if (!payload) return null;
  try {
    return JSON.parse(payload) as TokenClaims;
  } catch {
    return null;
  }
}

function projectId(): string | null {
  const id = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  return id && id.length > 0 ? id : null;
}

/** Cheap structural validation. See the file header for why this is not the boundary. */
function hasUsableSession(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20) return false;

  const claims = readClaims(token);
  if (!claims?.sub) return false;

  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return false;

  const expectedProject = projectId();
  if (expectedProject) {
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    if (aud !== expectedProject) return false;
  }

  if (claims.iss && !claims.iss.startsWith("https://securetoken.google.com/")) return false;

  return true;
}

export function proxy(request: NextRequest) {
  const pathname = normalizePath(request.nextUrl.pathname);
  const hasSession = hasUsableSession(request);

  /*
   * API requests must NOT be redirected.
   *
   * A redirect would send an XHR/fetch to the HTML login page and break the
   * JSON contract the browser client depends on. Route handlers already return
   * 401 with a structured error body, which is what the client needs to show
   * "please sign in" without a navigation. So the API surface is passed straight
   * through and authorised in the handler, where the session is verified for
   * real rather than structurally.
   */
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isProtectedPath(pathname) && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage(pathname) && hasSession) {
    const url = request.nextUrl.clone();
    const target = safeRedirectTarget(request.nextUrl.searchParams.get("next"));
    url.pathname = target;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets, image optimisation and
     * the favicon. Proxy runs on a cold instance per region, so keep the set of
     * matched paths to routes that genuinely need the auth UX.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest)$).*)",
  ],
};