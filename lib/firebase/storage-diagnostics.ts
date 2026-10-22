/**
 * Storage diagnostics — names the Storage failures a person can actually fix.
 *
 * The browser Storage SDK reports every failure as a terse string such as
 * `Firebase Storage: An unknown error occurred… (storage/unknown)`, which is
 * accurate and useless. Two of those failures are project-setup conditions that
 * take a minute to fix, so they are named explicitly:
 *
 *  - the configured bucket does not exist in the project (README 4.2, step 4);
 *  - the bucket exists but the deployed rules refuse the write (README 4.5).
 *
 * A missing bucket is measured, not assumed: the REST endpoint answers HTTP 404
 * and the SDK surfaces it as `storage/unknown`, so the message a person would
 * otherwise read names nothing at all.
 *
 * This module deliberately imports nothing from Firebase so it can be unit
 * tested without a project, a network, or credentials.
 */

export type StorageBucketProbe = "exists" | "missing" | "unknown";

/**
 * Classifies an unauthenticated `GET /v0/b/{bucket}/o` response.
 *
 *  - 404 is returned only for a bucket that does not exist;
 *  - a bucket that exists answers 200/400/401/403 from the rules engine
 *    (`Permission denied.`, `Listing objects … disallowed`), which is proof the
 *    bucket is there;
 *  - `null` means the endpoint could not be reached at all.
 */
export function classifyStorageBucketProbe(status: number | null): StorageBucketProbe {
  if (status === null) return "unknown";
  if (status === 404) return "missing";
  return "exists";
}

export function missingStorageBucketMessage(bucket: string): string {
  return (
    `Cannot upload: the Storage bucket "${bucket}" does not exist in this Firebase project. ` +
    `Create it in the Firebase console (Build → Storage → Get started — README section 4.2, step 4), ` +
    `or point NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET at the bucket this project does have.`
  );
}

export function unauthorizedStorageMessage(): string {
  return (
    "The upload was refused by your Storage security rules. " +
    "Deploy the rules in storage.rules to this project (README section 4.5), then try again."
  );
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Turns a raw Storage SDK error into a message worth showing, or `null` when
 * the error is already specific enough (a cancelled upload, a settings problem
 * reported elsewhere, or the repository's own timeout error).
 */
export function describeStorageFailure(error: unknown, bucket: string): string | null {
  if (typeof error !== "object" || error === null) return null;

  const record = error as { code?: unknown; status?: unknown };
  const code = asText(record.code);
  const status = asNumber(record.status);

  switch (code) {
    case "storage/bucket-not-found":
    case "storage/no-default-bucket":
    case "storage/invalid-default-bucket":
      return missingStorageBucketMessage(bucket);
    case "storage/unauthorized":
      return unauthorizedStorageMessage();
    case "storage/unauthenticated":
    case "storage/unauthorized-app":
      return "Your sign-in session expired before the upload started. Sign in again and retry the upload.";
    case "storage/quota-exceeded":
      return "This Firebase project has reached its Storage quota, so the file was not uploaded.";
    case "storage/retry-limit-exceeded":
      return "The upload could not be completed after repeated attempts. Check the connection, then try again.";
    case "storage/unknown":
      // The SDK reports a missing bucket as `storage/unknown` with HTTP 404 in
      // its server response; see README section 4.2 for the two ways to fix it.
      return status === 404 ? missingStorageBucketMessage(bucket) : null;
    default:
      // Older SDKs surface the same condition with no code at all.
      return status === 404 ? missingStorageBucketMessage(bucket) : null;
  }
}
