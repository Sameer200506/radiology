import { describe, expect, it, beforeEach } from "vitest";

import {
  buildStoragePath,
  isAuthPage,
  isProtectedPath,
  isSafeIdSegment,
  maskIp,
  normalizePath,
  ownsRecord,
  safeRedirectTarget,
  storagePathBelongsTo,
} from "@/lib/security/access";
import {
  RATE_LIMITS,
  identityFromRequest,
  rateLimit,
  resetRateLimits,
} from "@/lib/security/rate-limit";

/* ------------------------------------------------------------------ *
 * Path protection
 * ------------------------------------------------------------------ */

describe("isProtectedPath", () => {
  it("protects the dashboard and its children", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/dashboard/assessments")).toBe(true);
    expect(isProtectedPath("/dashboard/assessments/abc123")).toBe(true);
  });

  it("protects the AI API surface", () => {
    for (const path of [
      "/api/ai/intake",
      "/api/ai/assessment",
      "/api/ai/report",
      "/api/ai/image-analysis",
    ]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it("does not protect paths that no longer exist as routes", () => {
    // The data layer is Firestore now, gated by Security Rules instead of by a
    // session prefix. If one of these ever comes back it must be added back to
    // PROTECTED_PREFIXES.
    for (const path of ["/api/assessments", "/api/uploads", "/api/reports", "/api/account"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("leaves the marketing site public", () => {
    for (const path of ["/", "/faq", "/privacy", "/disclaimer", "/login", "/signup"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("does not protect a path that merely shares a prefix", () => {
    expect(isProtectedPath("/dashboard-public")).toBe(false);
    expect(isProtectedPath("/api/assessmentsomething")).toBe(false);
  });
});

describe("isAuthPage", () => {
  it("recognises the auth pages", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/signup")).toBe(true);
    expect(isAuthPage("/forgot-password")).toBe(true);
  });

  it("does not treat other routes as auth pages", () => {
    expect(isAuthPage("/dashboard")).toBe(false);
  });
});

describe("normalizePath", () => {
  it("strips a trailing slash", () => {
    expect(normalizePath("/dashboard/")).toBe("/dashboard");
    expect(normalizePath("/dashboard//")).toBe("/dashboard");
  });

  it("preserves the root", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("drops query and hash noise", () => {
    expect(normalizePath("/dashboard?tab=1#top")).toBe("/dashboard");
  });
});

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

describe("ownsRecord", () => {
  const userId = "user-a";

  it("allows the owner", () => {
    expect(ownsRecord({ userId }, userId)).toBe(true);
  });

  it("rejects a different user", () => {
    expect(ownsRecord({ userId }, "user-b")).toBe(false);
  });

  it("fails closed on a missing owner", () => {
    expect(ownsRecord({}, userId)).toBe(false);
    expect(ownsRecord({ userId: null }, userId)).toBe(false);
    expect(ownsRecord({ userId: "" }, userId)).toBe(false);
  });

  it("fails closed on a missing record", () => {
    expect(ownsRecord(null, userId)).toBe(false);
    expect(ownsRecord(undefined, userId)).toBe(false);
  });

  it("accepts the ownerId alias", () => {
    expect(ownsRecord({ ownerId: userId }, userId)).toBe(true);
  });

  it("prefers userId when both are present", () => {
    expect(ownsRecord({ userId: "user-b", ownerId: userId }, userId)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Identifier and path safety
 * ------------------------------------------------------------------ */

describe("isSafeIdSegment", () => {
  it("accepts a generated id", () => {
    expect(isSafeIdSegment("0f3ac9b1e2d4")).toBe(true);
    expect(isSafeIdSegment("abc-DEF_123")).toBe(true);
  });

  it("rejects traversal and separators", () => {
    expect(isSafeIdSegment("..")).toBe(false);
    expect(isSafeIdSegment("../../etc")).toBe(false);
    expect(isSafeIdSegment("a/b")).toBe(false);
    expect(isSafeIdSegment("a\\b")).toBe(false);
    expect(isSafeIdSegment("a b")).toBe(false);
    expect(isSafeIdSegment("")).toBe(false);
    expect(isSafeIdSegment("x".repeat(200))).toBe(false);
  });
});

describe("buildStoragePath", () => {
  it("namespaces under the user", () => {
    expect(
      buildStoragePath({ userId: "u1", assessmentId: "a1", fileId: "f1", extension: ".PDF" }),
    ).toBe("users/u1/a1/f1.pdf");
  });

  it("throws rather than building a path from an unsafe id", () => {
    expect(() =>
      buildStoragePath({ userId: "../etc", assessmentId: "a1", fileId: "f1", extension: ".pdf" }),
    ).toThrow();
  });

  it("drops an extension that is not a simple suffix", () => {
    expect(
      buildStoragePath({ userId: "u1", assessmentId: "a1", fileId: "f1", extension: "../x" }),
    ).toBe("users/u1/a1/f1");
  });
});

describe("storagePathBelongsTo", () => {
  it("accepts a path inside the user's namespace", () => {
    expect(storagePathBelongsTo("users/u1/a1/f1.pdf", "u1")).toBe(true);
  });

  it("rejects another user's path", () => {
    expect(storagePathBelongsTo("users/u2/a1/f1.pdf", "u1")).toBe(false);
  });

  it("rejects a path outside the expected shape", () => {
    expect(storagePathBelongsTo("u1/a1/f1.pdf", "u1")).toBe(false);
    expect(storagePathBelongsTo("users/u1", "u1")).toBe(false);
    expect(storagePathBelongsTo("", "u1")).toBe(false);
  });

  it("rejects a prefix impersonation", () => {
    expect(storagePathBelongsTo("users/u1x/a1/f1.pdf", "u1")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Redirect safety
 * ------------------------------------------------------------------ */

describe("safeRedirectTarget", () => {
  it("allows a same-origin relative path", () => {
    expect(safeRedirectTarget("/dashboard/assessments")).toBe("/dashboard/assessments");
  });

  it("falls back for an absolute URL", () => {
    expect(safeRedirectTarget("https://evil.example/steal")).toBe("/dashboard");
    expect(safeRedirectTarget("//evil.example/steal")).toBe("/dashboard");
    expect(safeRedirectTarget("/\\evil.example")).toBe("/dashboard");
  });

  it("falls back for a protocol-relative URL", () => {
    expect(safeRedirectTarget("javascript:alert(1)")).toBe("/dashboard");
  });

  it("falls back for an auth page to avoid a loop", () => {
    expect(safeRedirectTarget("/login")).toBe("/dashboard");
    expect(safeRedirectTarget("/signup")).toBe("/dashboard");
  });

  it("falls back for a missing value", () => {
    expect(safeRedirectTarget(null)).toBe("/dashboard");
    expect(safeRedirectTarget(undefined)).toBe("/dashboard");
    expect(safeRedirectTarget("")).toBe("/dashboard");
  });

  it("respects a custom fallback", () => {
    expect(safeRedirectTarget(null, "/assessment/new")).toBe("/assessment/new");
  });
});

/* ------------------------------------------------------------------ *
 * Audit-log privacy
 * ------------------------------------------------------------------ */

describe("maskIp", () => {
  it("masks the last two octets", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.masked.masked");
  });

  it("handles IPv4-mapped IPv6", () => {
    expect(maskIp("::ffff:203.0.113.45")).toBe("203.0.masked.masked");
  });

  it("masks an IPv6 address down to its first group", () => {
    // More masking is better than less: only the first hextet is retained.
    expect(maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:masked");
    expect(maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).not.toContain("7334");
  });

  it("handles a missing address", () => {
    expect(maskIp(null)).toBe("unknown");
    expect(maskIp("")).toBe("unknown");
    expect(maskIp("garbage")).toBe("masked");
  });
});

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests up to the limit", () => {
    for (let i = 0; i < RATE_LIMITS.intake.limit; i += 1) {
      const result = rateLimit({ identity: "u1", rule: RATE_LIMITS.intake, scope: "test" });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks once the limit is exceeded", () => {
    for (let i = 0; i < RATE_LIMITS.intake.limit; i += 1) {
      rateLimit({ identity: "u1", rule: RATE_LIMITS.intake, scope: "test" });
    }
    const blocked = rateLimit({ identity: "u1", rule: RATE_LIMITS.intake, scope: "test" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes counters by identity and by rule", () => {
    for (let i = 0; i < RATE_LIMITS.intake.limit; i += 1) {
      rateLimit({ identity: "u1", rule: RATE_LIMITS.intake, scope: "test" });
    }
    expect(rateLimit({ identity: "u2", rule: RATE_LIMITS.intake, scope: "test" }).allowed).toBe(true);
    expect(rateLimit({ identity: "u1", rule: RATE_LIMITS.assessment, scope: "other" }).allowed).toBe(
      true,
    );
  });

  it("resets once the window has elapsed", () => {
    const now = Date.now();
    for (let i = 0; i < RATE_LIMITS.session.limit; i += 1) {
      rateLimit({ identity: "u1", rule: RATE_LIMITS.session, scope: "test", now });
    }
    expect(rateLimit({ identity: "u1", rule: RATE_LIMITS.session, scope: "test", now }).allowed).toBe(
      false,
    );

    const later = now + RATE_LIMITS.session.windowMs + 1;
    expect(rateLimit({ identity: "u1", rule: RATE_LIMITS.session, scope: "test", now: later }).allowed).toBe(
      true,
    );
  });

  it("reports a decreasing remaining count", () => {
    const first = rateLimit({ identity: "u1", rule: RATE_LIMITS.upload, scope: "test" });
    const second = rateLimit({ identity: "u1", rule: RATE_LIMITS.upload, scope: "test" });
    expect(second.remaining).toBeLessThan(first.remaining);
  });
});

describe("identityFromRequest", () => {
  it("prefers a user id when signed in", () => {
    const request = new Request("https://example.com", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(identityFromRequest(request, "u1")).toBe("u:u1");
  });

  it("masks the ip when signed out", () => {
    const request = new Request("https://example.com", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const identity = identityFromRequest(request, null);
    expect(identity).toBe("ip:1.2.masked.masked");
    expect(identity).not.toContain("3.4");
  });

  it("handles a request with no forwarding header", () => {
    const request = new Request("https://example.com");
    expect(identityFromRequest(request, null)).toBe("ip:unknown");
  });
});

describe("rate limit configuration", () => {
  it("keeps expensive AI stages tighter than cheap reads", () => {
    expect(RATE_LIMITS.assessment.limit).toBeLessThan(RATE_LIMITS.session.limit);
    expect(RATE_LIMITS.intake.limit).toBeLessThanOrEqual(RATE_LIMITS.session.limit);
  });

  it("keeps the vision stage at or below the document stage", () => {
    expect(RATE_LIMITS.image.limit).toBeLessThanOrEqual(RATE_LIMITS.document.limit);
  });
});