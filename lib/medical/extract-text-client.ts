"use client";

/**
 * Browser-side PDF text extraction.
 *
 * ## Why this moved to the client
 *
 * Originally the server read the uploaded object out of Storage, parsed it with
 * pdf.js, and sent the text to OpenRouter. Reading Storage requires an Admin
 * credential, which a web-only Firebase config cannot provide. Extracting in the
 * browser removes that dependency entirely: the Route Handler receives plain
 * text and never touches Storage.
 *
 * It also keeps the request body small. Uploads are capped at 10 MB, but the
 * analysis request carries only the extracted text (capped at 40,000
 * characters), which stays well inside serverless body limits.
 *
 * ## What this does NOT do
 *
 * No OCR. A scanned PDF has no text layer, so we report that plainly and offer
 * a paste-in box instead of shipping an OCR model to a third party.
 */

import { cleanExtractedText, MAX_EXTRACTED_CHARS } from "@/lib/medical/text-cleanup";

export interface ExtractionResult {
  text: string;
  /** False when the PDF had no readable text layer. */
  textLayerFound: boolean;
  pages: number;
  characters: number;
  truncated: boolean;
  notes: string[];
}

const MAX_PAGES = 40;

export async function extractPdfTextInBrowser(file: File): Promise<ExtractionResult> {
  const notes: string[] = [];

  try {
    // Loaded on demand: pdf.js is large and only needed when a PDF is chosen.
    const { extractText, getDocumentProxy } = await import("unpdf");

    const buffer = await file.arrayBuffer();
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const totalPages = document.numPages;
    const pagesToRead = Math.min(totalPages, MAX_PAGES);

    if (totalPages > pagesToRead) {
      notes.push(
        `This document has ${totalPages} pages. Only the first ${pagesToRead} were read, so later pages are not represented in the analysis.`,
      );
    }

    // mergePages: false returns one string per page, which lets us cap the page
    // count before joining.
    const result = await extractText(document, { mergePages: false });
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];

    const combined = pageTexts
      .slice(0, pagesToRead)
      .map((chunk) => chunk ?? "")
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n\n");

    const cleaned = cleanExtractedText(combined);

    if (cleaned.trim().length === 0) {
      return {
        text: "",
        textLayerFound: false,
        pages: totalPages,
        characters: 0,
        truncated: false,
        notes: [
          "No selectable text could be extracted from this PDF. It is most likely a scan or a photograph of a report. Paste the written findings below so the report text can still be analysed.",
        ],
      };
    }

    // A handful of characters spread across many pages is a header plus a
    // scanned image, not content. Treat it as unreadable rather than analysing
    // noise, which would invite hallucination.
    const perPage = cleaned.length / Math.max(1, pagesToRead);
    if (cleaned.length < 200 && perPage < 40) {
      return {
        text: "",
        textLayerFound: false,
        pages: totalPages,
        characters: cleaned.length,
        truncated: false,
        notes: [
          "This PDF contains only a minimal text layer — the content is most likely scanned images. Paste the written findings below so the report text can still be analysed.",
        ],
      };
    }

    const truncated = cleaned.length > MAX_EXTRACTED_CHARS;
    const text = truncated ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : cleaned;

    if (truncated) {
      notes.push(
        `The extracted text exceeded ${MAX_EXTRACTED_CHARS.toLocaleString()} characters and was truncated. Values printed later in the document may be missing from the analysis.`,
      );
    }

    return { text, textLayerFound: true, pages: pagesToRead, characters: text.length, truncated, notes };
  } catch (error) {
    return {
      text: "",
      textLayerFound: false,
      pages: 0,
      characters: 0,
      truncated: false,
      notes: [
        `This PDF could not be parsed (${
          error instanceof Error ? error.name : "unknown error"
        }). Paste the written findings below so the report text can still be analysed.`,
      ],
    };
  }
}

/** Text the user typed or pasted into the manual-entry box. */
export function extractPastedText(input: string): ExtractionResult {
  const cleaned = cleanExtractedText(input ?? "");
  const truncated = cleaned.length > MAX_EXTRACTED_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : cleaned,
    textLayerFound: cleaned.trim().length > 0,
    pages: 1,
    characters: cleaned.length,
    truncated,
    notes: truncated ? ["The pasted text was truncated to fit the analysis budget."] : [],
  };
}

/** Images are never OCR'd; the UI says so and offers pasted text instead. */
export function imageExtractionResult(): ExtractionResult {
  return {
    text: "",
    textLayerFound: false,
    pages: 1,
    characters: 0,
    truncated: false,
    notes: [
      "Images are not read as text. A written report summary can still be analysed if you paste or type it below.",
    ],
  };
}

/** Reads a file as a data URL for the vision stage. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

/** SHA-256 of a file's bytes, for duplicate detection and audit. */
export async function hashFile(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}