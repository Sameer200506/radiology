/**
 * Upload and request size limits.
 *
 * Kept in one place so the browser, the analysis routes and the UI agree.
 *
 * The image cap is tighter than the document cap because a vision request
 * carries the image as base64, which inflates it by roughly 4/3, and serverless
 * platforms cap request bodies around 4.5 MB.
 */

/** Raw bytes accepted for any upload. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TOTAL_BYTES_PER_ASSESSMENT = 30 * 1024 * 1024; // 30 MB
export const MAX_FILES_PER_ASSESSMENT = 12;

/** Raw bytes of an image that may be sent for vision analysis (~2.9 MB). */
export const MAX_IMAGE_BYTES = 2_800_000;

/** Characters of a base64 data URL, including the `data:` prefix. */
export const MAX_INCOMING_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES * 1.37) + 128;

/** Characters of extracted document text accepted by the analysis route. */
export const MAX_INCOMING_TEXT_CHARS = 60_000;

/** Largest request body any analysis route will read. */
export const MAX_REQUEST_BODY_BYTES = 4_500 * 1024;

export {
  MAX_EXTRACTED_CHARS,
  cleanExtractedText,
} from "@/lib/medical/text-cleanup";