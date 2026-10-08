/**
 * Upload validation policy.
 *
 * Extensions are never trusted. Validation is layered:
 *   1. declared MIME type
 *   2. file extension
 *   3. magic-number signature sniffed from the first bytes
 *   4. size, and per-kind quotas
 *   5. filename hygiene
 *
 * All of it is pure so it can be unit tested with synthetic byte sequences.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_TOTAL_BYTES_PER_ASSESSMENT = 30 * 1024 * 1024; // 30 MB
export const MAX_FILES_PER_ASSESSMENT = 12;

export type UploadCategory = "pdf" | "image";

export interface AllowedMime {
  category: UploadCategory;
  mimeTypes: string[];
  extensions: string[];
  maxBytes: number;
}

export const ALLOWED: AllowedMime[] = [
  {
    category: "pdf",
    mimeTypes: ["application/pdf", "application/x-pdf"],
    extensions: [".pdf"],
    maxBytes: MAX_FILE_BYTES,
  },
  {
    category: "image",
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/avif"],
    extensions: [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".avif"],
    maxBytes: MAX_FILE_BYTES,
  },
];

export interface ValidationOk {
  ok: true;
  category: UploadCategory;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  /** Sanitised display name — never the raw client string. */
  displayName: string;
}

export interface ValidationFail {
  ok: false;
  code: "empty_file" | "too_large" | "mime_not_allowed" | "extension_mismatch" | "signature_mismatch" | "bad_filename" | "quota_exceeded";
  message: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

/* ------------------------------------------------------------------ *
 * Magic numbers
 * ------------------------------------------------------------------ */

interface SignatureRule {
  mimeType: string;
  category: UploadCategory;
  extension: string;
  /** Bytes to compare against. Offsets beyond the buffer are skipped. */
  checks: Array<{ offset: number; bytes: number[] }>;
}

/**
 * Minimal but real signature table. `bytes` are the literal byte values to
 * match at `offset`. An empty `checks` array means "no signature check for
 * this format" and the caller falls back to the MIME/extension agreement.
 */
const SIGNATURES: SignatureRule[] = [
  { mimeType: "application/pdf", category: "pdf", extension: ".pdf", checks: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
  { mimeType: "image/jpeg", category: "image", extension: ".jpg", checks: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    mimeType: "image/png",
    category: "image",
    extension: ".png",
    checks: [
      { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    ],
  },
  { mimeType: "image/webp", category: "image", extension: ".webp", checks: [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }] },
  { mimeType: "image/bmp", category: "image", extension: ".bmp", checks: [{ offset: 0, bytes: [0x42, 0x4d] }] },
  {
    mimeType: "image/tiff",
    category: "image",
    extension: ".tif",
    checks: [
      { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] },
      { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] },
    ],
  },
  {
    mimeType: "image/avif",
    category: "image",
    extension: ".avif",
    checks: [
      { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp"
      { offset: 8, bytes: [0x61, 0x76, 0x69, 0x66] }, // "avif"
    ],
  },
];

function matchesSignature(rule: SignatureRule, header: Uint8Array): boolean {
  // Multi-pattern rules (TIFF) match if ANY check matches.
  return rule.checks.some((check) => {
    const available = header.length - check.offset;
    if (available <= 0) return false;
    const limit = Math.min(check.bytes.length, available);
    for (let i = 0; i < limit; i += 1) {
      if (header[check.offset + i] !== check.bytes[i]) return false;
    }
    // Require the header to be long enough for at least 3 bytes to match.
    return limit >= 3;
  });
}

/* ------------------------------------------------------------------ *
 * Filename hygiene
 * ------------------------------------------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * Produces a display name that is safe to render and free of path traversal,
 * hidden characters and script injection vectors.
 */
export function sanitizeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "document";
  const cleaned = base
    .replace(CONTROL_CHARS, "")
    // Drop bidi overrides and zero-width characters used to disguise extensions.
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .replace(/[<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") {
    return "document";
  }
  return cleaned;
}

/** Truncates a display name for the UI without hiding the extension. */
export function shortenFileName(name: string, max = 48): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  // Budget for the ellipsis itself so the result never exceeds `max`.
  const keep = Math.max(4, max - ext.length - 1);
  return `${stem.slice(0, keep)}…${ext}`;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface ValidateUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** First bytes of the file. Supply when available. */
  header?: Uint8Array;
  /** Already used in this assessment, for quota checks. */
  existingFiles?: number;
  existingBytes?: number;
}

function findRule(mimeType: string): AllowedMime | null {
  const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED.find((rule) => rule.mimeTypes.includes(normalizedMime)) ?? null;
}

export function validateUpload(input: ValidateUploadInput): ValidationResult {
  const displayName = sanitizeFileName(input.fileName);
  if (displayName === "document" && input.fileName.trim().length === 0) {
    return { ok: false, code: "bad_filename", message: "The file could not be read. Please choose a file again." };
  }

  const extension = (() => {
    const dot = displayName.lastIndexOf(".");
    return dot > 0 ? displayName.slice(dot).toLowerCase() : "";
  })();

  if (input.sizeBytes <= 0) {
    return { ok: false, code: "empty_file", message: "That file appears to be empty. Please choose a different file." };
  }

  if (input.existingFiles !== undefined && input.existingFiles >= MAX_FILES_PER_ASSESSMENT) {
    return {
      ok: false,
      code: "quota_exceeded",
      message: `You can upload up to ${MAX_FILES_PER_ASSESSMENT} files per assessment. Remove one first.`,
    };
  }

  if (
    input.existingBytes !== undefined &&
    input.existingBytes + input.sizeBytes > MAX_TOTAL_BYTES_PER_ASSESSMENT
  ) {
    return {
      ok: false,
      code: "quota_exceeded",
      message: `This assessment has reached its ${Math.round(MAX_TOTAL_BYTES_PER_ASSESSMENT / (1024 * 1024))} MB total upload limit.`,
    };
  }

  const allowedMime = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const rule = findRule(allowedMime);

  // Media type first: an unsupported type is a clearer error than a mismatch
  // against an extension we were never going to accept anyway.
  if (!rule) {
    return {
      ok: false,
      code: "mime_not_allowed",
      message: `That file type is not supported. Upload a PDF, JPG, PNG, WEBP, BMP, TIFF or AVIF file.`,
    };
  }

  if (!rule.extensions.includes(extension)) {
    return {
      ok: false,
      code: "extension_mismatch",
      message: `The file extension does not match its type. Supported extensions: ${rule.extensions.join(", ")}.`,
    };
  }

  if (input.sizeBytes > rule.maxBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `That file is too large. The limit is ${Math.round(rule.maxBytes / (1024 * 1024))} MB per file.`,
    };
  }

  // Signature check when we have the bytes. Never trust the declared MIME alone.
  if (input.header && input.header.length >= 4) {
    const signature = SIGNATURES.find((s) => s.mimeType === allowedMime);
    if (signature && !matchesSignature(signature, input.header)) {
      return {
        ok: false,
        code: "signature_mismatch",
        message:
          "That file's contents do not match the file type it claims to be, so it was rejected.",
      };
    }
  }

  return {
    ok: true,
    category: rule.category,
    mimeType: allowedMime,
    extension,
    sizeBytes: input.sizeBytes,
    displayName,
  };
}

/** Guess a document kind from name and mime, for the analysis prompt. */
export function guessDocumentKind(fileName: string, mimeType: string): string {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || /\.(pdf)$/.test(name)) {
    if (/radiolog|ct|mri|x[-_]?ray|ultrasound|impression/.test(name)) return "radiology_report";
    if (/path|histopath|biopsy/.test(name)) return "pathology_report";
    if (/discharge|summary|handover/.test(name)) return "discharge_summary";
    if (/blood|cbc|labs?|panel|chemistry/.test(name)) return "blood_test";
    return "other";
  }
  if (mimeType.startsWith("image/")) return "imaging_image";
  return "other";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}