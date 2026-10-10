import { describe, expect, it, vi } from "vitest";
import { commitAnalysisUpload, hasSuccessfulImaging } from "@/components/assessment/steps/analysis-uploads";
import type { UploadState } from "@/components/assessment/wizard-store";

const image: UploadState = {
  id: "stored-image", fileName: "scan.png", displayName: "scan.png",
  mimeType: "image/png", sizeBytes: 100, kind: "other", status: "analyzed",
  imaging: { mode: "model_vision", observations: [{ observation: "Existing observation", uncertainty: "low", evidence: "test", limitations: [] }], limitations: [] },
};

describe("analysis upload persistence and retry", () => {
  it("persists a stored upload before publishing its successful analysis", async () => {
    const order: string[] = [];
    const patch = { imaging: image.imaging, status: "analyzed" as const };
    const persist = vi.fn(async () => { order.push("persisted"); });
    const apply = vi.fn(() => { order.push("applied"); });
    await commitAnalysisUpload(image.id, patch, new Set([image.id]), persist, apply);
    expect(persist).toHaveBeenCalledWith(image.id, patch);
    expect(apply).toHaveBeenCalledWith(image.id, patch);
    expect(order).toEqual(["persisted", "applied"]);
  });

  it("keeps synthetic documents in the case without creating upload metadata", async () => {
    const persist = vi.fn();
    const apply = vi.fn();
    const patch = { status: "analyzed" as const };
    await commitAnalysisUpload("synthetic-document", patch, new Set([image.id]), persist, apply);
    expect(persist).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith("synthetic-document", patch);
  });

  it("does not publish success on write failure, allowing a later retry to persist", async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const apply = vi.fn();
    const patch = { status: "analyzed" as const };
    await expect(commitAnalysisUpload(image.id, patch, new Set([image.id]), persist, apply)).rejects.toThrow("offline");
    expect(apply).not.toHaveBeenCalled();
    await commitAnalysisUpload(image.id, patch, new Set([image.id]), persist, apply);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("reuses successful imaging after reload even without a File", () => {
    expect(image.file).toBeUndefined();
    expect(hasSuccessfulImaging(image)).toBe(true);
    expect(hasSuccessfulImaging({ ...image, imaging: { mode: "report_text_only", observations: [], limitations: [] } })).toBe(true);
  });

  it("allows unavailable imaging to be tried again", () => {
    expect(hasSuccessfulImaging({ ...image, imaging: undefined })).toBe(false);
    expect(hasSuccessfulImaging({ ...image, imaging: { mode: "unavailable", observations: [], limitations: [] } })).toBe(false);
  });
});
