import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the Storage bucket probe.
 *
 * The module reads the six publishable Firebase values once at import time, so
 * every case re-imports it after setting the environment and stubbing `fetch`.
 */

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const BUCKET = "radio-c771b.firebasestorage.app";

function configureEnv() {
  for (const key of REQUIRED_KEYS) process.env[key] = "test";
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = BUCKET;
}

function clearEnv() {
  for (const key of REQUIRED_KEYS) delete process.env[key];
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/firebase/storage-health");
}

beforeEach(() => {
  configureEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
});

describe("probeStorageBucket", () => {
  it("reports a missing bucket once and reuses the verdict briefly", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { probeStorageBucket } = await loadModule();
    expect(await probeStorageBucket()).toBe("missing");
    expect(await probeStorageBucket()).toBe("missing");
    // The second call is served from the short-lived cache: one probe, not two.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks the bucket the app is actually configured with", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(null, { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { probeStorageBucket } = await loadModule();
    expect(await probeStorageBucket()).toBe("exists");
    expect(requestedUrl).toBe(
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`,
    );
  });

  it("reports unknown, rather than missing, when the endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { probeStorageBucket } = await loadModule();
    expect(await probeStorageBucket()).toBe("unknown");
  });

  it("reports unknown without probing when Firebase is not configured", async () => {
    clearEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { probeStorageBucket } = await loadModule();
    expect(await probeStorageBucket()).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("assertStorageBucketExists", () => {
  it("throws with the fix instructions when the bucket does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const { assertStorageBucketExists } = await loadModule();
    await expect(assertStorageBucketExists()).rejects.toThrow(BUCKET);
    await expect(assertStorageBucketExists()).rejects.toThrow(/Build → Storage → Get started/);
  });

  it("resolves when the bucket answers (even with a rules refusal)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 400 })));

    const { assertStorageBucketExists } = await loadModule();
    await expect(assertStorageBucketExists()).resolves.toBeUndefined();
  });

  it("does not block uploads when the probe cannot tell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { assertStorageBucketExists } = await loadModule();
    // "unknown" must never be treated as "missing": the real upload then
    // produces the error instead of a false accusation.
    await expect(assertStorageBucketExists()).resolves.toBeUndefined();
  });
});
