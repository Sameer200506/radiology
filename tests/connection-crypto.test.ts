/**
 * Unit tests for the encryption that protects ChatGPT connection cookies and
 * the OAuth `state` value. These run entirely offline.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConnectionCryptoError,
  connectionCryptoUnavailableReason,
  decryptJson,
  encryptJson,
  isConnectionCryptoAvailable,
} from "@/lib/ai/connection-crypto";

const ORIGINAL_ENV = { ...process.env };

const SECRET_KEYS = [
  "AI_CONNECTION_SECRET",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
] as const;

function clearSecrets() {
  for (const key of SECRET_KEYS) delete process.env[key];
}

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

describe("connection crypto", () => {
  it("round-trips a JSON payload", () => {
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";
    const value = { uid: "user-1", refreshToken: "secret-token", count: 2 };

    const token = encryptJson(value, "cookie:user-1");
    expect(token.startsWith("v1.")).toBe(true);
    // The plaintext must not be recoverable without the key.
    expect(token).not.toContain("secret-token");

    expect(decryptJson(token, "cookie:user-1")).toEqual(value);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";

    const first = encryptJson({ a: 1 }, "aad");
    const second = encryptJson({ a: 1 }, "aad");

    expect(first).not.toBe(second);
    expect(decryptJson(first, "aad")).toEqual({ a: 1 });
    expect(decryptJson(second, "aad")).toEqual({ a: 1 });
  });

  it("refuses to decrypt under a different associated data value", () => {
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";

    const token = encryptJson({ uid: "user-1" }, "cookie:user-1");

    expect(decryptJson(token, "cookie:user-2")).toBeNull();
  });

  it("returns null when the ciphertext or auth tag is tampered with", () => {
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";

    const token = encryptJson({ ok: true }, "aad");
    const [version, iv, tag, data] = token.split(".");
    const tamperedTag = `${version}.${iv}.${Buffer.from("not-the-tag").toString("base64url")}.${data}`;
    const tamperedData = `${version}.${iv}.${tag}.${Buffer.from("different").toString("base64url")}`;

    expect(decryptJson(tamperedTag, "aad")).toBeNull();
    expect(decryptJson(tamperedData, "aad")).toBeNull();
  });

  it("returns null for malformed or empty tokens instead of throwing", () => {
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";

    expect(decryptJson("", "aad")).toBeNull();
    expect(decryptJson("v2.a.b.c", "aad")).toBeNull();
    expect(decryptJson("v1.only-two", "aad")).toBeNull();
    expect(decryptJson("not-a-token", "aad")).toBeNull();
  });

  it("reports unavailable in production without any server secret", () => {
    clearSecrets();
    vi.stubEnv("NODE_ENV", "production");

    expect(isConnectionCryptoAvailable()).toBe(false);
    expect(connectionCryptoUnavailableReason()).toMatch(/AI_CONNECTION_SECRET/);
    expect(() => encryptJson({ a: 1 }, "aad")).toThrow(ConnectionCryptoError);
  });

  it("is available in production when a server secret is configured", () => {
    clearSecrets();
    process.env.AI_CONNECTION_SECRET = "test-secret-value-that-is-long-enough";
    vi.stubEnv("NODE_ENV", "production");

    expect(isConnectionCryptoAvailable()).toBe(true);
    expect(connectionCryptoUnavailableReason()).toBeNull();
  });

  it("falls back to the deployment AI key when no dedicated secret exists", () => {
    clearSecrets();
    process.env.OPENROUTER_API_KEY = "openrouter-key-that-is-long-enough";

    expect(isConnectionCryptoAvailable()).toBe(true);
  });
});
