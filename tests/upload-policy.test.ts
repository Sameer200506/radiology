import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  formatBytes,
  guessDocumentKind,
  MAX_FILE_BYTES,
  MAX_FILES_PER_ASSESSMENT,
  MAX_TOTAL_BYTES_PER_ASSESSMENT,
  sanitizeFileName,
  shortenFileName,
  validateUpload,
} from "@/lib/security/upload-policy";

/** Magic-number headers for the formats we accept. */
const HEADERS = {
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
} as const;

/** A valid PDF header followed by a shell-script payload. */
const DISGUISED = new Uint8Array([
  0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68, 0x0a, 0x72, 0x6d, 0x20, 0x2d, 0x72, 0x66,
]);

function upload(overrides: Partial<Parameters<typeof validateUpload>[0]> = {}) {
  return validateUpload({
    fileName: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128 * 1024,
    header: HEADERS.pdf,
    ...overrides,
  });
}

describe("validateUpload — accepts legitimate files", () => {
  it("accepts a PDF with a matching signature", () => {
    const result = upload();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.category).toBe("pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.extension).toBe(".pdf");
    }
  });

  it("accepts a JPEG", () => {
    const result = upload({
      fileName: "xray.jpg",
      mimeType: "image/jpeg",
      header: HEADERS.jpeg,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.category).toBe("image");
  });

  it("accepts a PNG", () => {
    const result = upload({
      fileName: "scan.png",
      mimeType: "image/png",
      header: HEADERS.png,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a filename with no directory component risk", () => {
    const result = upload({ fileName: "  Blood_Test 2024.pdf  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.displayName).toBe("Blood_Test 2024.pdf");
  });
});

describe("validateUpload — rejects bad input", () => {
  it("rejects an empty file", () => {
    const result = upload({ sizeBytes: 0 });
    expect(result).toMatchObject({ ok: false, code: "empty_file" });
  });

  it("rejects an oversized file", () => {
    const result = upload({ sizeBytes: MAX_FILE_BYTES + 1 });
    expect(result).toMatchObject({ ok: false, code: "too_large" });
  });

  it("rejects an unsupported media type", () => {
    const result = upload({ fileName: "notes.txt", mimeType: "text/plain" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.code).toBe("mime_not_allowed");
  });

  it("rejects an executable disguised as a PDF", () => {
    const result = upload({ header: DISGUISED });
    expect(result).toMatchObject({ ok: false, code: "signature_mismatch" });
  });

  it("rejects a renamed executable with a .pdf extension", () => {
    const result = upload({
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      header: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), // MZ: PE executable
    });
    expect(result).toMatchObject({ ok: false, code: "signature_mismatch" });
  });

  it("rejects a PDF extension on an image payload", () => {
    const result = upload({ fileName: "not-really.pdf", header: HEADERS.png });
    expect(result).toMatchObject({ ok: false, code: "signature_mismatch" });
  });

  it("rejects a mime type that does not match the extension", () => {
    const result = upload({ fileName: "image.jpg", mimeType: "application/pdf" });
    expect(result).toMatchObject({ ok: false, code: "extension_mismatch" });
  });

  it("rejects a filename with no extension", () => {
    const result = upload({ fileName: "report", mimeType: "application/pdf" });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpload — quotas", () => {
  it("rejects once the file count limit is reached", () => {
    const result = upload({ existingFiles: MAX_FILES_PER_ASSESSMENT });
    expect(result).toMatchObject({ ok: false, code: "quota_exceeded" });
  });

  it("rejects once the total byte limit would be exceeded", () => {
    const result = upload({ existingBytes: MAX_TOTAL_BYTES_PER_ASSESSMENT });
    expect(result).toMatchObject({ ok: false, code: "quota_exceeded" });
  });

  it("allows a file that fits inside the remaining budget", () => {
    const result = upload({ existingFiles: 3, existingBytes: 5 * 1024 * 1024 });
    expect(result.ok).toBe(true);
  });
});

describe("sanitizeFileName", () => {
  it("strips directory traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\system32\\config")).toBe("config");
  });

  it("removes path separators", () => {
    expect(sanitizeFileName("a/b/c.pdf")).toBe("c.pdf");
  });

  it("removes bidi override characters used to hide extensions", () => {
    const hidden = "report\u202Efdp.pdf";
    expect(sanitizeFileName(hidden)).not.toContain("\u202E");
  });

  it("removes zero-width characters", () => {
    expect(sanitizeFileName("re\u200Bport.pdf")).toBe("report.pdf");
  });

  it("removes characters that could inject markup", () => {
    expect(sanitizeFileName('<script>alert(1)</script>.pdf')).not.toMatch(/[<>]/);
  });

  it("strips control characters", () => {
    expect(sanitizeFileName("re\u0000port\u0007.pdf")).toBe("report.pdf");
  });

  it("falls back for degenerate names", () => {
    expect(sanitizeFileName("")).toBe("document");
    expect(sanitizeFileName(".")).toBe("document");
    expect(sanitizeFileName("..")).toBe("document");
    expect(sanitizeFileName("   ")).toBe("document");
  });

  it("caps the length", () => {
    expect(sanitizeFileName(`${"a".repeat(400)}.pdf`).length).toBeLessThanOrEqual(120);
  });

  it("does not alter a normal clinical filename", () => {
    expect(sanitizeFileName("Full Blood Count - 2026-04-12.pdf")).toBe(
      "Full Blood Count - 2026-04-12.pdf",
    );
  });
});

describe("shortenFileName", () => {
  it("leaves a short name alone", () => {
    expect(shortenFileName("scan.pdf")).toBe("scan.pdf");
  });

  it("truncates the stem but keeps the extension", () => {
    const long = `${"x".repeat(200)}.pdf`;
    const short = shortenFileName(long);
    expect(short.endsWith(".pdf")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(48);
    expect(short).toContain("…");
  });
});

describe("guessDocumentKind", () => {
  it("recognises a blood test", () => {
    expect(guessDocumentKind("Full Blood Count.pdf", "application/pdf")).toBe("blood_test");
  });

  it("recognises a radiology report", () => {
    expect(guessDocumentKind("chest-xray-report.pdf", "application/pdf")).toBe("radiology_report");
  });

  it("recognises a pathology report", () => {
    expect(guessDocumentKind("histopathology biopsy.pdf", "application/pdf")).toBe("pathology_report");
  });

  it("treats images as imaging", () => {
    expect(guessDocumentKind("scan.jpg", "image/jpeg")).toBe("imaging_image");
  });

  it("falls back to other", () => {
    expect(guessDocumentKind("notes.pdf", "application/pdf")).toBe("other");
  });
});

describe("formatBytes", () => {
  it("formats each magnitude", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("handles nonsense input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("policy constants", () => {
  it("only permits pdf and image categories", () => {
    for (const rule of ALLOWED) {
      expect(["pdf", "image"]).toContain(rule.category);
      expect(rule.maxBytes).toBeLessThanOrEqual(MAX_FILE_BYTES);
    }
  });

  it("keeps limits conservative enough for a serverless function", () => {
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(MAX_TOTAL_BYTES_PER_ASSESSMENT).toBeLessThanOrEqual(40 * 1024 * 1024);
    expect(MAX_FILES_PER_ASSESSMENT).toBeLessThanOrEqual(20);
  });
});