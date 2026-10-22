import { describe, expect, it } from "vitest";

import {
  classifyStorageBucketProbe,
  describeStorageFailure,
  missingStorageBucketMessage,
  unauthorizedStorageMessage,
} from "@/lib/firebase/storage-diagnostics";

const BUCKET = "radio-c771b.firebasestorage.app";

describe("classifyStorageBucketProbe", () => {
  it("treats 404 as a bucket that does not exist", () => {
    expect(classifyStorageBucketProbe(404)).toBe("missing");
  });

  it("treats rules-engine answers as proof the bucket exists", () => {
    // An existing bucket answers from the rules engine even without a token:
    // 403 Permission denied, 400 "Listing objects … disallowed", or 200 when
    // the bucket is public. Only an absent bucket answers 404.
    for (const status of [200, 400, 401, 403]) {
      expect(classifyStorageBucketProbe(status)).toBe("exists");
    }
  });

  it("reports unknown when the endpoint could not be reached", () => {
    expect(classifyStorageBucketProbe(null)).toBe("unknown");
  });
});

describe("describeStorageFailure", () => {
  it("names the missing bucket for the exact error the SDK returns today", () => {
    // Observed against a project whose Storage bucket was never created:
    // code storage/unknown, HTTP 404, body {"error":{"code":404,"message":"Not Found."}}
    const error = Object.assign(new Error("Firebase Storage: An unknown error occurred"), {
      code: "storage/unknown",
      status: 404,
    });

    expect(describeStorageFailure(error, BUCKET)).toBe(missingStorageBucketMessage(BUCKET));
  });

  it("names the missing bucket for the dedicated SDK codes", () => {
    for (const code of ["storage/bucket-not-found", "storage/no-default-bucket"]) {
      expect(describeStorageFailure({ code, status: 404 }, BUCKET)).toBe(
        missingStorageBucketMessage(BUCKET),
      );
    }
  });

  it("explains refused rules", () => {
    expect(describeStorageFailure({ code: "storage/unauthorized", status: 403 }, BUCKET)).toBe(
      unauthorizedStorageMessage(),
    );
  });

  it("tells an expired session apart from a rules refusal", () => {
    expect(describeStorageFailure({ code: "storage/unauthenticated", status: 401 }, BUCKET)).toContain(
      "expired",
    );
  });

  it("leaves unrelated failures untouched", () => {
    expect(describeStorageFailure(new Error("Uploading this document is taking too long."), BUCKET)).toBeNull();
    expect(describeStorageFailure({ code: "storage/canceled", status: 0 }, BUCKET)).toBeNull();
    expect(describeStorageFailure({ code: "storage/unknown", status: 500 }, BUCKET)).toBeNull();
    expect(describeStorageFailure(undefined, BUCKET)).toBeNull();
    expect(describeStorageFailure("storage/unknown", BUCKET)).toBeNull();
  });

  it("puts the bucket name in the message so it can be compared with the console", () => {
    expect(missingStorageBucketMessage(BUCKET)).toContain(BUCKET);
  });
});
