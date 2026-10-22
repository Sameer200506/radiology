/**
 * Local storage route tests.
 *
 * Exercise the real route handlers — authentication guard, ownership check,
 * size limits, disk round trip — with only the session lookup mocked. The
 * filesystem is a throwaway temp directory, so nothing touches the project's
 * real `.local-storage`.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/session";
import {
  DELETE as DELETE_FILE,
  GET as GET_FILE,
  PUT as PUT_FILE,
} from "@/app/api/storage/files/[...path]/route";
import { GET as GET_STATUS } from "@/app/api/storage/status/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { MAX_FILE_BYTES } from "@/lib/uploads/limits";

const UID = "user_test1";
const STORAGE_PATH = `users/${UID}/assessment1/file1abc.png`;
const SEGMENTS = STORAGE_PATH.split("/");

const mockedSession = vi.mocked(getSessionUser);

function signedIn(): void {
  mockedSession.mockResolvedValue({
    uid: UID,
    email: "tester@example.com",
    emailVerified: true,
    displayName: null,
    photoURL: null,
  });
}

function fileRequest(method: string, segments: string[], body?: Uint8Array<ArrayBuffer>): Request {
  const url = `http://localhost/api/storage/files/${segments.map(encodeURIComponent).join("/")}`;
  return new Request(url, {
    method,
    ...(body ? { body, headers: { "Content-Type": "image/png" } } : {}),
  });
}

function context(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) };
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "medassist-local-routes-"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("LOCAL_STORAGE_DIR", tempRoot);
  resetRateLimits();
  signedIn();
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
  mockedSession.mockReset();
});

describe("GET /api/storage/status", () => {
  it("reports the local driver when enabled", async () => {
    const response = await GET_STATUS(new Request("http://localhost/api/storage/status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ driver: "local" });
  });

  it("reports firebase when the driver is off", async () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    const response = await GET_STATUS(new Request("http://localhost/api/storage/status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ driver: "firebase" });
  });
});

describe("/api/storage/files", () => {
  it("round-trips a file through PUT, GET and DELETE", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    const put = await PUT_FILE(
      fileRequest("PUT", SEGMENTS, bytes),
      context(SEGMENTS),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, path: STORAGE_PATH, bytes: bytes.byteLength });

    const onDisk = path.join(tempRoot, "users", UID, "assessment1", "file1abc.png");
    expect(existsSync(onDisk)).toBe(true);

    const get = await GET_FILE(fileRequest("GET", SEGMENTS), context(SEGMENTS));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    const served = new Uint8Array(await get.arrayBuffer());
    expect(Array.from(served)).toEqual(Array.from(bytes));

    const remove = await DELETE_FILE(fileRequest("DELETE", SEGMENTS), context(SEGMENTS));
    expect(remove.status).toBe(200);
    expect(existsSync(onDisk)).toBe(false);

    const missing = await GET_FILE(fileRequest("GET", SEGMENTS), context(SEGMENTS));
    expect(missing.status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    mockedSession.mockResolvedValue(null);
    const put = await PUT_FILE(
      fileRequest("PUT", SEGMENTS, new Uint8Array([1])),
      context(SEGMENTS),
    );
    expect(put.status).toBe(401);
  });

  it("refuses a path owned by another account", async () => {
    const foreign = ["users", "someone_else", "assessment1", "file1abc.png"];
    const put = await PUT_FILE(
      fileRequest("PUT", foreign, new Uint8Array([1])),
      context(foreign),
    );
    expect(put.status).toBe(400);

    const get = await GET_FILE(fileRequest("GET", foreign), context(foreign));
    expect(get.status).toBe(404);
  });

  it("refuses traversal segments", async () => {
    const hostile = ["users", UID, "assessment1", ".."];
    const put = await PUT_FILE(
      fileRequest("PUT", hostile, new Uint8Array([1])),
      context(hostile),
    );
    expect(put.status).toBe(400);
  });

  it("enforces the size limit and refuses empty uploads", async () => {
    const empty = await PUT_FILE(
      fileRequest("PUT", SEGMENTS, new Uint8Array(0)),
      context(SEGMENTS),
    );
    expect(empty.status).toBe(400);

    const oversized = await PUT_FILE(
      fileRequest("PUT", SEGMENTS, new Uint8Array(MAX_FILE_BYTES + 1)),
      context(SEGMENTS),
    );
    expect(oversized.status).toBe(413);
  }, 30_000);

  it("is a plain 404 when the local driver is not enabled", async () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    for (const response of await Promise.all([
      PUT_FILE(fileRequest("PUT", SEGMENTS, new Uint8Array([1])), context(SEGMENTS)),
      GET_FILE(fileRequest("GET", SEGMENTS), context(SEGMENTS)),
      DELETE_FILE(fileRequest("DELETE", SEGMENTS), context(SEGMENTS)),
    ])) {
      expect(response.status).toBe(404);
    }
  });
});
