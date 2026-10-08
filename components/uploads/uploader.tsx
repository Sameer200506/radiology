"use client";

import * as React from "react";
import { FileText, ImageIcon, Loader2, Trash2, UploadCloud, Camera } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/security/upload-policy";
import { MAX_FILE_BYTES } from "@/lib/uploads/limits";

export interface PendingUpload {
  key: string;
  file: File;
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error: string | null;
}

export interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Text describing what is acceptable. */
  hint?: string;
  id?: string;
}

/**
 * Drag-and-drop upload surface.
 *
 * Mobile-first: a visible "Take or choose a photo" control is always present so
 * the camera flow is reachable without drag support. Keyboard users get a real
 * file input triggered by the button.
 */
export function UploadDropzone({
  onFiles,
  disabled = false,
  hint,
  id = "upload-input",
}: UploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "relative rounded-3xl border-2 border-dashed p-6 text-center transition-all sm:p-10",
        dragging
          ? "border-brand bg-brand/8 scale-[1.005]"
          : "border-line-strong bg-surface/40 hover:border-brand/45 hover:bg-brand/[0.03]",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so re-selecting the same file fires change again.
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-brand/20 bg-brand/8">
        <UploadCloud className="size-6 text-brand" aria-hidden="true" />
      </div>

      <p className="mt-5 text-sm font-medium text-ink">
        Drop files here, or choose them from your device
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-subtle">
        {hint ??
          `PDF, JPG, PNG or WEBP. Up to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB per file, ${formatBytes(30 * 1024 * 1024)} in total.`}
      </p>

      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <FileText className="size-4" aria-hidden="true" />
          Choose files
        </Button>
        <Button type="button" variant="ghost" onClick={() => cameraRef.current?.click()} disabled={disabled}>
          <Camera className="size-4" aria-hidden="true" />
          Take a photo
        </Button>
      </div>

      <p className="mt-4 text-[0.6875rem] leading-relaxed text-subtle">
        Please avoid uploading documents that show your name, address or national identifier.
      </p>
    </div>
  );
}

/** Row in the uploaded-files list. */
export function UploadRow({
  displayName,
  mimeType,
  sizeBytes,
  status,
  error,
  onRemove,
  busy = false,
}: {
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  status: "pending" | "uploading" | "analyzed" | "uploaded" | "failed";
  error?: string | null;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const isImage = mimeType.startsWith("image/");
  const Icon = isImage ? ImageIcon : FileText;

  const statusLabel = {
    pending: "Waiting",
    uploading: "Uploading",
    uploaded: "Uploaded",
    analyzed: "Analysed",
    failed: "Failed",
  }[status];

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-surface/50 p-3.5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="size-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink" title={displayName}>
          {displayName}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
          <span>{formatBytes(sizeBytes)}</span>
          <span aria-hidden="true">·</span>
          <span>{isImage ? "Image" : "Document"}</span>
        </p>

        <div className="mt-2 flex items-center gap-2">
          {status === "uploading" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-brand" role="status">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Uploading…
            </span>
          ) : (
            <Badge tone={status === "failed" ? "critical" : status === "analyzed" ? "good" : "neutral"} size="sm">
              {statusLabel}
            </Badge>
          )}
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-xs leading-relaxed text-critical">
            {error}
          </p>
        ) : null}
      </div>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded-full p-2 text-subtle transition-colors hover:bg-critical/10 hover:text-critical focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
          aria-label={`Remove ${displayName}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}