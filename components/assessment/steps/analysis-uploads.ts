import type { UploadState } from "@/components/assessment/wizard-store";

/** Commit metadata before exposing success locally, so a failed write is retried. */
export async function commitAnalysisUpload(
  id: string,
  patch: Partial<UploadState>,
  storedIds: ReadonlySet<string>,
  persist: (id: string, patch: Partial<UploadState>) => Promise<void>,
  apply: (id: string, patch: Partial<UploadState>) => void,
) {
  if (storedIds.has(id)) await persist(id, patch);
  apply(id, patch);
}

export function hasSuccessfulImaging(upload: UploadState): boolean {
  return Boolean(upload.imaging && upload.imaging.mode !== "unavailable");
}
