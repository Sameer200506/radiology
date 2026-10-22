"use client";

/**
 * Browser-side plumbing for the local disk storage driver.
 *
 * The browser cannot read server environment variables, so which driver this
 * deployment uses comes from `/api/storage/status` at runtime and is cached per
 * page. When the local driver is active, uploads, previews and deletes go
 * through `/api/storage/files/...` instead of the Firebase Storage SDK — same
 * `users/{uid}/{assessmentId}/{fileId}{ext}` paths, same session check.
 *
 * Any failure to resolve defaults to "firebase": the production path stays the
 * default, and a signed-out user gets the real upload error rather than a
 * silently different one.
 */

import { api } from "@/lib/api/client";

export type StorageDriver = "local" | "firebase";

let cachedDriver: StorageDriver | null = null;
let inflight: Promise<StorageDriver> | null = null;

/** Resolves the active storage driver once per page, then from cache. */
export function resolveStorageDriver(): Promise<StorageDriver> {
  if (cachedDriver) return Promise.resolve(cachedDriver);
  if (inflight) return inflight;

  inflight = api
    .get<{ driver?: StorageDriver }>("/api/storage/status")
    .then((response) => {
      cachedDriver = response.driver === "local" ? "local" : "firebase";
      return cachedDriver;
    })
    .catch(() => "firebase" as StorageDriver)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** The driver once resolved, for hints; null until the first resolution. */
export function getResolvedStorageDriver(): StorageDriver | null {
  return cachedDriver;
}

/** Same-origin URL that serves a stored file back (driver-agnostic name). */
export function storageFileUrl(storagePath: string): string {
  const encoded = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/storage/files/${encoded}`;
}

function localErrorMessage(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/** PUTs raw bytes to the local driver. Throws a user-safe Error on failure. */
export async function uploadLocalFile(
  storagePath: string,
  file: Blob,
  mimeType: string,
): Promise<void> {
  const response = await fetch(storageFileUrl(storagePath), {
    method: "PUT",
    headers: { "Content-Type": mimeType || "application/octet-stream" },
    body: file,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new Error(localErrorMessage(body, "Could not save this file to local test storage."));
  }
}

/** DELETEs a stored file from the local driver. */
export async function deleteLocalStoredFile(storagePath: string): Promise<void> {
  const response = await fetch(storageFileUrl(storagePath), {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not remove this file from local test storage.");
  }
}
