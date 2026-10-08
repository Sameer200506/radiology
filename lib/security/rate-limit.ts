/**
 * In-memory rate limiter.
 *
 * Scope note, stated plainly: this is per-instance and therefore best-effort.
 * On Vercel serverless, instances are ephemeral and cold, so it stops a single
 * user from hammering one instance and stops obvious abuse patterns. It is NOT a
 * distributed limiter. A production deployment that needs hard global limits
 * should put a durable store (e.g. Upstash Redis) behind the same interface.
 *
 * The interface is intentionally the shape such a store would implement, so
 * swapping it in is a single-file change.
 */

import { maskIp } from "@/lib/security/access";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix ms at which the window resets. */
  resetAt: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  /** One page. */
  session: { limit: 30, windowMs: 60_000 },
  /** Stage 1. */
  intake: { limit: 12, windowMs: 10 * 60_000 },
  /** Stage 2. */
  questions: { limit: 20, windowMs: 10 * 60_000 },
  /** Per document. */
  document: { limit: 40, windowMs: 10 * 60_000 },
  /** Vision is the most expensive stage. */
  image: { limit: 20, windowMs: 10 * 60_000 },
  /** Stage 5. */
  assessment: { limit: 12, windowMs: 10 * 60_000 },
  /** Report rendering. */
  report: { limit: 60, windowMs: 10 * 60_000 },
  /** Upload slots. */
  upload: { limit: 40, windowMs: 10 * 60_000 },
  /** Generic authenticated writes. */
  write: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const store = new Map<string, Bucket>();

/** Keeps the map from growing without bound on long-lived instances. */
const MAX_TRACKED_KEYS = 20_000;
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  if (store.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitInput {
  /** Stable identity: the Firebase uid when available, else a masked IP. */
  identity: string;
  rule: RateLimitRule;
  scope: string;
  now?: number;
}

export function rateLimit(input: RateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now();
  sweep(now);

  const key = `${input.scope}:${input.identity}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + input.rule.windowMs };
    store.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(0, input.rule.limit - 1),
      resetAt: bucket.resetAt,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;

  if (existing.count > input.rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, input.rule.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

/** Extracts a privacy-preserving rate-limit identity from a request. */
export function identityFromRequest(request: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
  return `ip:${maskIp(ip)}`;
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  store.clear();
}