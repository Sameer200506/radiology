/**
 * Access-control primitives.
 *
 * These functions are pure so they can be unit tested without Firebase, and so
 * the same logic is reused by proxy.ts, Route Handlers and Server Components.
 *
 * IMPORTANT: this module is defence in depth, not the primary control. The
 * primary control is Firestore and Storage Security Rules, which run inside
 * Firebase and cannot be bypassed by a modified client. Server-side checks here
 * exist to fail fast and to avoid leaking the existence of another user's
 * records through a 403-versus-404 difference.
 */

/**
 * Paths that require a session cookie.
 *
 * The `/api/ai/*` routes are stateless: they hold no per-user data and derive
 * everything from the request body, but they still gate on a session so the
 * OpenRouter key cannot be used as an open relay by an anonymous caller. The
 * data prefixes that used to sit here (`/api/assessments`, `/api/uploads`,
 * `/api/reports`, `/api/account`) are gone — that data lives in Firestore now,
 * behind Security Rules rather than behind a route.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/assessment",
  "/reports",
  "/settings",
  "/profile",
  "/api/ai",
] as const;

export const AUTH_PAGES = ["/login", "/signup", "/forgot-password"] as const;

export function isProtectedPath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  return PROTECTED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(normalizePath(pathname));
}

/** Strips trailing slashes (except root) and any query/hash noise. */
export function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.replace(/\/+$/, "");
  }
  return withoutQuery || "/";
}

export interface OwnedRecord {
  userId?: string | null;
  ownerId?: string | null;
}

/**
 * Ownership test.
 *
 * A record is accessible only when it carries an explicit owner id matching the
 * caller. A record with no owner id is treated as NOT accessible — fail closed.
 */
export function ownsRecord(record: OwnedRecord | null | undefined, userId: string): boolean {
  if (!record) return false;
  const owner = record.userId ?? record.ownerId;
  if (typeof owner !== "string" || owner.length === 0) return false;
  return owner === userId;
}

/** Safe storage path segment: never allows traversal or empty ids. */
export function isSafeIdSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Storage paths are always `users/{uid}/{assessmentId}/{fileId}{ext}`. */
export function buildStoragePath(params: {
  userId: string;
  assessmentId: string;
  fileId: string;
  extension: string;
}): string {
  const { userId, assessmentId, fileId, extension } = params;
  if (!isSafeIdSegment(userId) || !isSafeIdSegment(assessmentId) || !isSafeIdSegment(fileId)) {
    throw new Error("Refusing to build a storage path from an unsafe identifier.");
  }
  const ext = /^\.[A-Za-z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : "";
  return `users/${userId}/${assessmentId}/${fileId}${ext}`;
}

/**
 * Confirms a storage path belongs to the given user.
 *
 * Storage Rules already enforce this. This is the server-side double check that
 * keeps a bug in path construction from becoming a data leak.
 */
export function storagePathBelongsTo(storagePath: string, userId: string): boolean {
  if (!storagePath.startsWith("users/")) return false;
  const segments = storagePath.split("/");
  if (segments.length < 4) return false;
  if (segments[0] !== "users") return false;
  return segments[1] === userId;
}

/**
 * Where to send a user after they authenticate.
 *
 * Only same-origin relative paths are honoured; anything else falls back to the
 * dashboard. Prevents open-redirect via the `?next=` parameter.
 */
export function safeRedirectTarget(candidate: string | null | undefined, fallback = "/dashboard"): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (candidate.includes("://")) return fallback;
  if (candidate.startsWith("/login") || candidate.startsWith("/signup")) return fallback;
  return candidate;
}

/** Masks a client IP for audit logs. Never store a full IP. */
export function maskIp(ip: string | null): string {
  if (!ip) return "unknown";
  const cleaned = ip.replace("::ffff:", "");
  if (cleaned.includes(":")) return `${cleaned.split(":")[0] ?? "unknown"}:masked`;
  const parts = cleaned.split(".");
  if (parts.length !== 4) return "masked";
  return `${parts[0]}.${parts[1]}.masked.masked`;
}