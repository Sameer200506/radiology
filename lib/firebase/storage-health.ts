"use client";

/**
 * One cheap, cached check of whether the configured Storage bucket exists.
 *
 * Uploads are the one operation in this app that cannot work at all without
 * project setup: a bucket that was never created (README 4.2, step 4) makes
 * every attempt fail no matter how good the connection is, and the Storage SDK
 * reports it only as `An unknown error occurred (storage/unknown)`. Checking the
 * bucket first turns that into a one-line message naming the fix.
 *
 * The probe is deliberately unauthenticated. For an existing bucket the rules
 * engine answers 400/401/403 (proof enough that the bucket is there); only a
 * genuinely absent bucket answers 404. A probe that cannot reach Google at all
 * reports "unknown" and lets the real upload produce its own error.
 */

import { firebaseClientEnv } from "@/lib/firebase/client";
import {
  classifyStorageBucketProbe,
  missingStorageBucketMessage,
  type StorageBucketProbe,
} from "@/lib/firebase/storage-diagnostics";

/** How long the probe waits before deciding it cannot tell. */
const PROBE_TIMEOUT_MS = 8_000;
/** A "missing" verdict is re-checked after this long, so fixing the project and
 *  retrying works without a page reload. A bucket cannot start existing and
 *  disappear by accident, so "exists" is cached for the whole page. */
const MISSING_TTL_MS = 10_000;

let cached: { state: StorageBucketProbe; at: number } | null = null;
let inFlight: Promise<StorageBucketProbe> | null = null;

/** The bucket the client is configured with, or "" when Firebase is unset. */
export function storageBucketName(): string {
  return firebaseClientEnv().config?.storageBucket ?? "";
}

async function runProbe(bucket: string): Promise<StorageBucketProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o`,
      { method: "GET", cache: "no-store", signal: controller.signal },
    );
    return classifyStorageBucketProbe(response.status);
  } finally {
    clearTimeout(timer);
  }
}

export function probeStorageBucket(): Promise<StorageBucketProbe> {
  if (cached && (cached.state === "exists" || Date.now() - cached.at < MISSING_TTL_MS)) {
    return Promise.resolve(cached.state);
  }
  if (inFlight) return inFlight;

  const bucket = storageBucketName();
  if (bucket.length === 0) return Promise.resolve("unknown");

  inFlight = runProbe(bucket)
    .catch((): StorageBucketProbe => "unknown")
    .then((state) => {
      cached = { state, at: Date.now() };
      inFlight = null;
      return state;
    });

  return inFlight;
}

/**
 * Throws with the fix instructions when the bucket is definitely absent.
 * Called immediately before uploading so the person never waits for a doomed
 * request to time out.
 */
export async function assertStorageBucketExists(): Promise<void> {
  const bucket = storageBucketName();
  if (bucket.length === 0) return;
  if ((await probeStorageBucket()) === "missing") {
    throw new Error(missingStorageBucketMessage(bucket));
  }
}
