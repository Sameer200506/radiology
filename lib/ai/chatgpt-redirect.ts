import "server-only";

import { NextResponse } from "next/server";

/**
 * Redirects an OAuth start/callback back to the Settings card with a small,
 * fixed status code. Provider error text and tokens never go into the URL.
 */
export function settingsRedirect(
  origin: string,
  status: string,
  reason?: string,
): NextResponse {
  const url = new URL("/dashboard/settings", origin);
  url.searchParams.set("chatgpt", status);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

/** Same, for a route that only has a Request. */
export function settingsRedirectFromRequest(
  request: Request,
  status: string,
  reason?: string,
): NextResponse {
  return settingsRedirect(new URL(request.url).origin, status, reason);
}
