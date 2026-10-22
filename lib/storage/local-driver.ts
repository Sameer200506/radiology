import "server-only";

/**
 * Local disk storage driver — development and testing only.
 *
 * Uploads normally go to Firebase Storage, which requires a bucket that only
 * exists once the project is on Blaze (README 4.2). For local testing that
 * setup should not be a prerequisite, so when `STORAGE_DRIVER=local` the same
 * upload flow writes bytes to `.local-storage/` on this machine instead.
 *
 * The contract mirrors production exactly: paths stay
 * `users/{uid}/{assessmentId}/{fileId}{ext}`, every request is authorised by
 * the session, and a path may only ever be read or written by its owner. The
 * difference is where the bytes live, not who may touch them.
 *
 * This driver must never be enabled on a deployment: a serverless filesystem
 * is not durable and separate instances do not share it.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSafeIdSegment } from "@/lib/security/access";

/** True when the operator explicitly opted into disk-backed storage. */
export function localStorageDriverEnabled(): boolean {
  return (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase() === "local";
}

/**
 * Where files land. Defaults to `<project>/.local-storage`, which is
 * gitignored; `LOCAL_STORAGE_DIR` overrides it (absolute or relative).
 */
export function localStorageRoot(): string {
  const configured = process.env.LOCAL_STORAGE_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0
      ? configured
      : path.join(process.cwd(), ".local-storage"),
  );
}

/**
 * Final path segment: a safe id plus an optional short extension, exactly what
 * the client's `buildStoragePath` produces (`e0f3...c9.jpg`). A leading dot is
 * impossible, so `.` and `..` can never validate.
 */
const FILE_SEGMENT = /^[A-Za-z0-9_-]{1,128}(?:\.[A-Za-z0-9]{1,10})?$/;

/**
 * Splits and validates a storage path against its owner.
 *
 * Returns null for anything that is not exactly
 * `users/{userId}/{assessmentId}/{fileId}{ext}` with safe segments — wrong
 * owner, traversal attempts, backslashes and NUL bytes all fail here.
 */
export function parseLocalStoragePath(storagePath: string, userId: string): string[] | null {
  if (typeof storagePath !== "string") return null;
  if (storagePath.includes("\\") || storagePath.includes("\0")) return null;

  const segments = storagePath.split("/");
  if (segments.length !== 4) return null;

  const [root, owner, assessmentId, file] = segments as [string, string, string, string];
  if (root !== "users") return null;
  if (owner !== userId || !isSafeIdSegment(owner)) return null;
  if (!isSafeIdSegment(assessmentId)) return null;
  if (!FILE_SEGMENT.test(file)) return null;

  return segments;
}

/**
 * Absolute on-disk location for a validated storage path, or null.
 *
 * The segments are validated first, then the resolved path is checked against
 * the root again — defence in depth, so a validation bug can still never write
 * outside `.local-storage`.
 */
export function resolveLocalFilePath(storagePath: string, userId: string): string | null {
  const segments = parseLocalStoragePath(storagePath, userId);
  if (!segments) return null;

  const root = localStorageRoot();
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Writes `bytes` atomically (temp file + rename). Returns the byte count. */
export async function saveLocalFile(
  storagePath: string,
  userId: string,
  bytes: Uint8Array,
): Promise<number> {
  const destination = resolveLocalFilePath(storagePath, userId);
  if (!destination) {
    throw new Error("Refusing to write to a local storage path outside the storage root.");
  }

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.uploading`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
  return bytes.byteLength;
}

/** Returns the bytes, or null when the path is invalid or the file is absent. */
export async function readLocalFile(
  storagePath: string,
  userId: string,
): Promise<Uint8Array | null> {
  const source = resolveLocalFilePath(storagePath, userId);
  if (!source) return null;

  try {
    return await readFile(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Deletes the file if present. Invalid paths are refused, not followed. */
export async function deleteLocalFile(storagePath: string, userId: string): Promise<void> {
  const target = resolveLocalFilePath(storagePath, userId);
  if (!target) return;
  await rm(target, { force: true });
}

/**
 * Content type for serving a stored file back.
 *
 * Deliberately a small allow-list: `image/svg+xml` and HTML are NOT served as
 * active types because a stored SVG/HTML file would otherwise execute scripts
 * on this origin. Anything unmapped is served as an opaque download.
 */
export function contentTypeForLocalFile(storagePath: string): string {
  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(storagePath)?.[0].toLowerCase() ?? "";
  const known: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
  };
  return known[extension] ?? "application/octet-stream";
}
