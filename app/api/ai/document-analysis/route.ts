/**
 * POST /api/ai/document-analysis — Stage 3.
 *
 * Stateless by design: the browser extracts the PDF text layer (see
 * lib/medical/extract-text-client.ts) and sends the text here. The route never
 * reads Storage, so it needs no Firebase Admin credential.
 *
 * The text is sanitised, identifier-redacted and framed as untrusted before it
 * reaches the model, and every returned value must be locatable in the source.
 */

import { runDocumentAnalysis } from "@/lib/ai/stages";
import { guardedRoute, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Extracted text is capped; the browser applies the same limit before sending. */
const MAX_INCOMING_TEXT = 60_000;

interface RequestBody {
  /** Extracted text, either from the PDF text layer or pasted by the user. */
  extractedText?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export async function POST(request: Request) {
  return guardedRoute({ limit: "document" }, async ({ request: req }) => {
    const raw = await readJsonBody<RequestBody>(req, 256 * 1024);

    const extractedText = (raw.extractedText ?? "").trim();
    const fileName = (raw.fileName ?? "document").slice(0, 200);
    const mimeType = (raw.mimeType ?? "text/plain").slice(0, 120);
    const sizeBytes = typeof raw.sizeBytes === "number" ? raw.sizeBytes : extractedText.length;

    if (extractedText.length === 0) {
      // Not an error. A scanned PDF has no text layer, and the correct response
      // is to say so rather than to guess. runDocumentAnalysis short-circuits
      // this path without spending a model call.
      return jsonOk(
        {
          analysis: {
            documentType: "unknown",
            findings: [],
            reportRecommendations: [],
            warnings: [
              "No readable text was supplied for this document. A scanned report or a photograph of a report cannot be read as text — paste the written findings to have them analysed instead.",
            ],
            extraction: { characters: 0, pages: 0, textLayerFound: false },
            truncated: false,
          },
          modelCalled: false,
        },
        200,
        API_HEADERS,
      );
    }

    const source = extractedText.slice(0, MAX_INCOMING_TEXT);

    const outcome = await runDocumentAnalysis({
      readable: true,
      fileName,
      mimeType,
      sizeBytes,
      extractedText: source,
      extraction: {
        characters: source.length,
        pages: 1,
        textLayerFound: true,
        truncated: extractedText.length > MAX_INCOMING_TEXT,
      },
    });

    return jsonOk(
      {
        analysis: {
          ...outcome.data,
          extraction: {
            characters: source.length,
            pages: 1,
            textLayerFound: true,
          },
          truncated: extractedText.length > MAX_INCOMING_TEXT,
        },
        audit: outcome.audit,
        modelCalled: outcome.audit.model !== "skipped",
      },
      200,
      API_HEADERS,
    );
  })(request);
}