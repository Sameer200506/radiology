"use client";

import * as React from "react";
import {
  AlertCircle,
  Camera,
  FileCheck2,
  FileText,
  ImageIcon,
  Info,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UploadDropzone } from "@/components/uploads/uploader";
import { WizardNav } from "@/components/assessment/steps/information-symptoms";
import { ImageViewer } from "@/components/imaging/image-viewer";
import { useAuth } from "@/components/auth/auth-provider";
import { useWizard, type UploadState, type WizardStep } from "@/components/assessment/wizard-store";
import { api, errorMessage } from "@/lib/api/client";
import { deleteUpload, updateUpload, uploadFile, writeAuditLog } from "@/lib/data";
import { guessDocumentKind, sanitizeFileName, shortenFileName } from "@/lib/security/upload-policy";
import {
  extractPdfTextInBrowser,
  extractPastedText,
  hashFile,
  imageExtractionResult,
} from "@/lib/medical/extract-text-client";
import { MAX_FILE_BYTES } from "@/lib/uploads/limits";
import { isVisionAnalysisAvailableHint } from "@/components/medical/vision-note";

/**
 * Step 4 — uploads.
 *
 * The whole path runs in the browser: validate, extract PDF text locally,
 * upload bytes to Storage, and register metadata in Firestore. Nothing is sent
 * to the server unless there is text for the model to transcribe or an image
 * for a vision model to describe.
 */
export function StepDocuments() {
  const { state, dispatch } = useWizard();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [error, setError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<UploadState | null>(null);
  const [pastedFor, setPastedFor] = React.useState<UploadState | null>(null);
  const [pastedText, setPastedText] = React.useState("");
  const [analysing, setAnalysing] = React.useState<string | null>(null);

  const visionAvailable = isVisionAnalysisAvailableHint();

  const analyseText = React.useCallback(
    async (upload: UploadState, text: string) => {
      if (!uid || !state.assessmentId) return;
      setAnalysing(upload.id);
      try {
        const response = await api.post<{
          analysis: NonNullable<UploadState["analysis"]>;
        }>("/api/ai/document-analysis", {
          extractedText: text,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
        });

        dispatch({
          type: "patchUpload",
          payload: { id: upload.id, patch: { analysis: response.analysis, status: "analyzed" } },
        });

        // Persist immediately. `state` cannot be re-read inside this callback,
        // so the wizard store alone would not see this analysis before the
        // analysis step builds its case snapshot.
        await updateUpload(uid, state.assessmentId, upload.id, {
          analysis: response.analysis,
          status: "analyzed",
        });

        setPastedFor(null);
        setPastedText("");
      } catch (analysisError) {
        setError(errorMessage(analysisError, "The text could not be analysed."));
      } finally {
        setAnalysing(null);
      }
    },
    [uid, state.assessmentId, dispatch],
  );

  const handleFiles = React.useCallback(
    async (files: File[]) => {
      setError(null);
      if (!uid || !state.assessmentId) {
        setError("The assessment is still being created. Try again in a moment.");
        return;
      }

      for (const file of files) {
        const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
        const displayName = shortenFileName(sanitizeFileName(file.name));
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const isImage = file.type.startsWith("image/");

        const optimistic: UploadState = {
          file,
          id: tempId,
          fileName: sanitizeFileName(file.name),
          displayName,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          kind: guessDocumentKind(file.name, file.type) as UploadState["kind"],
          status: "pending",
          uploading: true,
          error: null,
        };
        dispatch({ type: "addUpload", payload: optimistic });

        try {
          if (file.size > MAX_FILE_BYTES) {
            throw new Error(
              `That file is larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
            );
          }

          // Extract locally so the server never needs Storage read access.
          const extraction = isPdf
            ? await extractPdfTextInBrowser(file)
            : isImage
              ? imageExtractionResult()
              : { ...imageExtractionResult(), notes: ["Unsupported file type."] };

          const contentHash = await hashFile(file);

          const { record, previewUrl } = await uploadFile(uid, state.assessmentId, {
            fileName: optimistic.fileName,
            displayName,
            mimeType: optimistic.mimeType,
            sizeBytes: file.size,
            contentHash,
            kind: optimistic.kind as UploadState["kind"],
            file,
          });

          dispatch({
            type: "patchUpload",
            payload: {
              id: tempId,
              patch: {
                id: record.id,
                status: "uploaded",
                uploading: false,
                previewUrl,
                extractedText: extraction.textLayerFound ? extraction.text : undefined,
                extractionNotes: extraction.notes,
              },
            },
          });

          void writeAuditLog({
            action: "upload_created",
            resourceType: "upload",
            resourceId: record.id,
            metadata: { isImage, sizeBytes: file.size, textLayerFound: extraction.textLayerFound },
          });

          // Transcribe immediately when there is text, so the documents step
          // shows real findings rather than a pending state.
          if (extraction.textLayerFound && extraction.text.trim().length > 0) {
            await analyseText(
              {
                ...optimistic,
                id: record.id,
                fileName: optimistic.fileName,
                sizeBytes: file.size,
                extractedText: extraction.text,
              },
              extraction.text,
            );
          }
        } catch (uploadError) {
          const message = errorMessage(uploadError, "That file could not be uploaded.");
          dispatch({
            type: "patchUpload",
            payload: { id: tempId, patch: { status: "failed", uploading: false, error: message } },
          });
          setError(`${displayName}: ${message}`);
        }
      }
    },
    [uid, state.assessmentId, dispatch, analyseText],
  );

  const removeUpload = React.useCallback(
    async (upload: UploadState) => {
      if (!uid || !state.assessmentId) return;
      dispatch({ type: "patchUpload", payload: { id: upload.id, patch: { uploading: true } } });

      try {
        // Synthetic demo documents were never stored, so nothing to remove.
        if (!upload.id.startsWith("demo-")) {
          await deleteUpload(uid, state.assessmentId, upload.id);
        }
        dispatch({ type: "removeUpload", payload: upload.id });
        void writeAuditLog({
          action: "upload_deleted",
          resourceType: "upload",
          resourceId: upload.id,
        });
      } catch (deleteError) {
        dispatch({
          type: "patchUpload",
          payload: { id: upload.id, patch: { uploading: false, error: errorMessage(deleteError) } },
        });
        toast.error(errorMessage(deleteError, "That file could not be removed."));
      }
    },
    [uid, state.assessmentId, dispatch],
  );

  const savePastedText = async () => {
    if (!pastedFor) return;
    const parsed = extractPastedText(pastedText);
    if (!parsed.textLayerFound) {
      setError("There is no text to analyse.");
      return;
    }
    await analyseText(pastedFor, parsed.text);
  };

  const allUploads = state.uploads;
  const unreadable = allUploads.filter((upload) => !upload.analysis && !upload.extractedText);

  return (
    <div className="space-y-7">
      <header>
        <Badge tone="brand">Step 4</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
          Upload reports and images
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Optional, and usually the most useful part. Files are stored privately in your own
          account. Laboratory values are transcribed exactly as printed, so you can check them
          against the original.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-critical/30 bg-critical/8 p-4 text-sm leading-relaxed text-ink"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <UploadDropzone onFiles={(files) => void handleFiles(files)} />

      {allUploads.length > 0 ? (
        <section aria-labelledby="uploads-heading">
          <div className="flex items-center justify-between gap-3">
            <h3 id="uploads-heading" className="text-sm font-semibold text-ink">
              {allUploads.length} file{allUploads.length === 1 ? "" : "s"} added
            </h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setError(null)} className="text-xs">
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Dismiss
            </Button>
          </div>

          <ul className="mt-3 space-y-2.5">
            {allUploads.map((upload) => (
              <li key={upload.id} className="space-y-2">
                <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface/50 p-3.5">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    {upload.mimeType.startsWith("image/") ? (
                      <ImageIcon className="size-4" aria-hidden="true" />
                    ) : (
                      <FileText className="size-4" aria-hidden="true" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink" title={upload.fileName}>
                      {upload.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-subtle">
                      {Math.round(upload.sizeBytes / 1024)} KB ·{" "}
                      {upload.mimeType.startsWith("image/") ? "Image" : "Document"}
                    </p>

                    <div className="mt-2">
                      {upload.uploading ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-brand" role="status">
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                          Uploading…
                        </span>
                      ) : upload.status === "analyzed" ? (
                        <Badge tone="good" size="sm">
                          Analysed
                        </Badge>
                      ) : upload.status === "failed" ? (
                        <Badge tone="critical" size="sm">
                          Failed
                        </Badge>
                      ) : (
                        <Badge tone="neutral" size="sm">
                          Uploaded
                        </Badge>
                      )}
                    </div>

                    {upload.error ? (
                      <p role="alert" className="mt-2 text-xs leading-relaxed text-critical">
                        {upload.error}
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => void removeUpload(upload)}
                    disabled={upload.uploading}
                    className="rounded-full p-2 text-subtle transition-colors hover:bg-critical/10 hover:text-critical focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
                    aria-label={`Remove ${upload.displayName}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>

                {upload.extractionNotes && upload.extractionNotes.length > 0 ? (
                  <ul className="space-y-1.5 pl-14">
                    {upload.extractionNotes.map((note) => (
                      <li key={note} className="text-xs leading-relaxed text-caution">
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pl-14">
                  {upload.previewUrl ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setViewing(upload)}>
                      <Plus className="size-3.5" aria-hidden="true" />
                      View image
                    </Button>
                  ) : null}

                  {upload.extractedText && !upload.analysis ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void analyseText(upload, upload.extractedText as string)}
                      loading={analysing === upload.id}
                    >
                      <FileCheck2 className="size-3.5" aria-hidden="true" />
                      Analyse this text
                    </Button>
                  ) : null}

                  {upload.analysis && upload.analysis.findings.length > 0 ? (
                    <Badge tone="good" size="sm">
                      {upload.analysis.findings.length} values transcribed
                    </Badge>
                  ) : null}

                  {upload.imaging?.mode === "model_vision" ? (
                    <Badge tone="accent" size="sm">
                      {upload.imaging.observations.length} visual observations
                    </Badge>
                  ) : null}

                  {upload.imaging?.mode === "unavailable" ? (
                    <Badge tone="neutral" size="sm">
                      Image not analysed
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="glass rounded-3xl border-info/25 bg-info/5 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/12 text-info">
            <Info className="size-[1.05rem]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Image analysis vs report analysis</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {visionAvailable
                ? "A written radiology report is transcribed and analysed in full. An uploaded image is described by a vision-capable model as unverified observations, with uncertainty stated."
                : "A written radiology report can still be analysed. Image analysis is not available with the currently configured model, so nothing on this page is derived from the pixels of an uploaded image."}
            </p>
          </div>
        </div>
      </div>

      {unreadable.length > 0 ? (
        <div className="glass rounded-3xl p-5">
          <h3 className="text-sm font-semibold text-ink">No readable text?</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Scanned reports and photographs of paper cannot be read as text. Type or paste the
            findings and that text will be analysed in exactly the same way.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              const target = unreadable[0];
              if (!target) return;
              setPastedFor(target);
              setPastedText("");
            }}
          >
            <Keyboard className="size-3.5" aria-hidden="true" />
            Paste report text instead
          </Button>
        </div>
      ) : null}

      <WizardNav
        onBack={() => dispatch({ type: "setStep", payload: 2 as WizardStep })}
        onNext={() => dispatch({ type: "setStep", payload: 4 as WizardStep })}
        nextLabel="Analyse my information"
        hint={
          allUploads.length === 0
            ? "You can continue without uploading anything."
            : "Everything is analysed during the next step."
        }
      />

      <Dialog open={Boolean(pastedFor)} onOpenChange={(open) => !open && setPastedFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paste the report text</DialogTitle>
            <DialogDescription>
              Type or paste what your report says. Values are transcribed from this text exactly as
              written — nothing is inferred or filled in.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-3">
            <label htmlFor="pasted-report" className="text-sm font-medium text-ink">
              Report text
            </label>
            <Textarea
              id="pasted-report"
              rows={10}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder={"Test: Haemoglobin\nResult: 10.2\nUnit: g/dL\nReference: 13-17"}
              maxLength={60_000}
            />
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setPastedFor(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePastedText()}
              disabled={pastedText.trim().length === 0}
              loading={analysing === pastedFor?.id}
            >
              Analyse this text
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {viewing?.previewUrl ? (
        <ImageViewer
          src={viewing.previewUrl}
          alt={`Uploaded medical image: ${viewing.fileName}`}
          fileName={viewing.displayName}
          observations={viewing.imaging?.observations}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

export { Camera, updateUpload };
