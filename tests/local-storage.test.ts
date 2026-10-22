/**
 * Local disk storage driver tests.
 *
 * These are hermetic: they run against a throwaway directory in the OS temp
 * folder, never the project's real `.local-storage`, and exercise the exact
 * validation the /api/storage/files routes rely on — ownership, traversal and
 * content-type safety.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contentTypeForLocalFile,
  deleteLocalFile,
  localStorageDriverEnabled,
  localStorageRoot,
  parseLocalStoragePath,
  readLocalFile,
  resolveLocalFilePath,
  saveLocalFile,
} from "@/lib/storage/local-driver";

const UID = "user_test1";
const VALID_PATH = `users/${UID}/assessment1/file1abc.png`;

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "medassist-local-storage-"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("LOCAL_STORAGE_DIR", tempRoot);
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("driver flag", () => {
  it("is enabled only by an explicit local value", () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(localStorageDriverEnabled()).toBe(true);

    vi.stubEnv("STORAGE_DRIVER", " LOCAL ");
    expect(localStorageDriverEnabled()).toBe(true);

    vi.stubEnv("STORAGE_DRIVER", "firebase");
    expect(localStorageDriverEnabled()).toBe(false);

    vi.stubEnv("STORAGE_DRIVER", "");
    expect(localStorageDriverEnabled()).toBe(false);
  });

  it("resolves the configured root and defaults to the project folder", () => {
    expect(localStorageRoot()).toBe(path.resolve(tempRoot));

    vi.stubEnv("LOCAL_STORAGE_DIR", "");
    expect(localStorageRoot()).toBe(path.resolve(process.cwd(), ".local-storage"));
  });
});

describe("path validation", () => {
  it("accepts exactly users/{uid}/{assessmentId}/{fileId}{ext}", () => {
    expect(parseLocalStoragePath(VALID_PATH, UID)).toEqual([
      "users",
      UID,
      "assessment1",
      "file1abc.png",
    ]);
    // No extension is valid too (buildStoragePath falls back to `.bin` today,
    // but an extension-less segment must not become a traversal vector).
    expect(parseLocalStoragePath(`users/${UID}/a1/file1`, UID)).not.toBeNull();
  });

  it("rejects paths owned by anyone else", () => {
    expect(parseLocalStoragePath(`users/other/e1/f.png`, UID)).toBeNull();
  });

  it("rejects traversal, separators and malformed segments", () => {
    const hostile = [
      `users/${UID}/a1/../f.png`,
      `users/${UID}/a1/..`,
      `users/${UID}/a1/.`,
      `users/../a1/f.png`,
      `users/${UID}/..%2F/f.png`,
      `users\\${UID}\\a1\\f.png`,
      `users/${UID}/a1/f.png/extra`,
      `users/${UID}/f.png`,
      `users/${UID}/a1/f.png\u0000`,
      `users/${UID}/a1/f.pngextraordinarilylong`,
      `users/${UID}//f.png`,
    ];
    for (const candidate of hostile) {
      expect(parseLocalStoragePath(candidate, UID), candidate).toBeNull();
    }
  });

  it("keeps every resolved file inside the storage root", () => {
    const resolved = resolveLocalFilePath(VALID_PATH, UID);
    expect(resolved).toBe(path.join(tempRoot, "users", UID, "assessment1", "file1abc.png"));
    expect(resolveLocalFilePath(`users/other/e1/f.png`, UID)).toBeNull();
  });
});

describe("disk operations", () => {
  it("round-trips bytes through save, read and delete", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await saveLocalFile(VALID_PATH, UID, bytes)).toBe(bytes.byteLength);

    const onDisk = path.join(tempRoot, "users", UID, "assessment1", "file1abc.png");
    expect(existsSync(onDisk)).toBe(true);

    const readBack = await readLocalFile(VALID_PATH, UID);
    expect(readBack && Array.from(readBack)).toEqual(Array.from(bytes));

    await deleteLocalFile(VALID_PATH, UID);
    expect(existsSync(onDisk)).toBe(false);
    expect(await readLocalFile(VALID_PATH, UID)).toBeNull();
  });

  it("refuses to write outside the root and leaves no temp files behind", async () => {
    await expect(
      saveLocalFile(`users/someone-else/a1/f.png`, UID, new Uint8Array([1])),
    ).rejects.toThrow(/outside the storage root/);

    await mkdir(path.join(tempRoot, "users", UID, "a1"), { recursive: true });
    const existing = path.join(tempRoot, "users", UID, "a1", "f.png");
    await writeFile(existing, new Uint8Array([1, 2, 3]));

    // A second save replaces the file atomically.
    await saveLocalFile(`users/${UID}/a1/f.png`, UID, new Uint8Array([9, 9]));
    const readBack = await readLocalFile(`users/${UID}/a1/f.png`, UID);
    expect(readBack && Array.from(readBack)).toEqual([9, 9]);
    expect(existsSync(`${existing}.uploading`)).toBe(false);
  });

  it("treats deletion of a missing file as success", async () => {
    await expect(deleteLocalFile(VALID_PATH, UID)).resolves.toBeUndefined();
  });
});

describe("content types", () => {
  it("serves known preview formats with their real type", () => {
    expect(contentTypeForLocalFile("a/b/f.png")).toBe("image/png");
    expect(contentTypeForLocalFile("a/b/f.JPG")).toBe("image/jpeg");
    expect(contentTypeForLocalFile("a/b/f.webp")).toBe("image/webp");
    expect(contentTypeForLocalFile("a/b/f.pdf")).toBe("application/pdf");
    expect(contentTypeForLocalFile("a/b/f.txt")).toBe("text/plain; charset=utf-8");
  });

  it("never serves active content types (svg/html) from stored files", () => {
    expect(contentTypeForLocalFile("a/b/f.svg")).toBe("application/octet-stream");
    expect(contentTypeForLocalFile("a/b/f.html")).toBe("application/octet-stream");
    expect(contentTypeForLocalFile("a/b/f")).toBe("application/octet-stream");
  });
});
