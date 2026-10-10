import { describe, expect, it } from "vitest";

import { isSecureRequest, sessionCookieOptions } from "@/lib/auth/session";

describe("session cookie protocol detection", () => {
  it("does not mark a LAN HTTP origin Secure even with a misleading proxy header", () => {
    const request = new Request("http://192.168.1.8:3114/api/auth/session", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(isSecureRequest(request)).toBe(false);
    expect(sessionCookieOptions(60, isSecureRequest(request)).secure).toBe(false);
  });

  it("trusts HTTPS forwarded by a production TLS terminator", () => {
    const request = new Request("http://app.internal/api/auth/session", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(isSecureRequest(request)).toBe(true);
  });
});
