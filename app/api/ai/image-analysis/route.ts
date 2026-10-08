/**
 * POST /api/ai/image-analysis — Stage 4.
 *
 * Stateless by design: the browser reads the image and posts it as a data URL.
 * The route never reads Storage, so it needs no Firebase Admin credential.
 *
 * Vision availability is checked BEFORE the payload is inspected, so an
 * unconfigured deployment never pays to base64-decode an image it will refuse
 * to look at.
 */

import { runImagingAnalysis } from "@/lib/ai/stages";
import { isVisionAnalysisAvailable, visionModel } from "@/lib/ai/models";
import { guardedRoute, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";
import { MAX_INCOMING_IMAGE_CHARS } from "@/lib/uploads/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const VISION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface RequestBody {
  /** A `data:` URL produced by FileReader in the browser. */
  imageDataUrl: string;
  fileName?: string;
  contextNote?: string;
}

export async function POST(request: Request) {
  return guardedRoute({ limit: "image" }, async ({ request: req }) => {
    const raw = await readJsonBody<RequestBody>(req, 12 * 1024 * 1024);

    // The honest default: with no vision model pinned, say so and do nothing.
    if (!isVisionAnalysisAvailable()) {
      return jsonOk(
        {
          imaging: {
            mode: "unavailable" as const,
            observations: [],
            limitations: [
              "No image analysis was performed. Nothing in this report is derived from the pixels of the uploaded image.",
            ],
            unavailableReason:
              "Image analysis is not available with the currently configured model. A written radiology report can still be analyzed.",
          },
          modelConfiguredForVision: false,
        },
        200,
        API_HEADERS,
      );
    }

    const dataUrl = (raw.imageDataUrl ?? "").trim();
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);

    if (!match?.[1] || !match[2]) {
      return jsonOk(
        {
          imaging: {
            mode: "unavailable" as const,
            observations: [],
            limitations: [],
            unavailableReason:
              "That image could not be read. Upload a JPG, PNG or WEBP file and try again.",
          },
          modelConfiguredForVision: false,
        },
        200,
        API_HEADERS,
      );
    }

    const mimeType = match[1];
    const base64 = match[2];

    if (!VISION_MIME_TYPES.has(mimeType)) {
      return jsonOk(
        {
          imaging: {
            mode: "unavailable" as const,
            observations: [],
            limitations: [],
            unavailableReason: `The configured vision model cannot read ${mimeType} files.`,
          },
          modelConfiguredForVision: false,
        },
        200,
        API_HEADERS,
      );
    }

    // Base64 inflates by ~4/3. Reject before decoding so an oversized payload
    // never becomes a multi-megabyte string in memory.
    if (dataUrl.length > MAX_INCOMING_IMAGE_CHARS) {
      return jsonOk(
        {
          imaging: {
            mode: "unavailable" as const,
            observations: [],
            limitations: [],
            unavailableReason:
              "That image is too large to analyse. Please upload a smaller or more compressed image.",
          },
          modelConfiguredForVision: true,
          model: visionModel(),
        },
        200,
        API_HEADERS,
      );
    }

    const outcome = await runImagingAnalysis({
      fileName: (raw.fileName ?? "image").slice(0, 200),
      mimeType,
      base64,
      ...(typeof raw.contextNote === "string" && raw.contextNote.trim().length > 0
        ? { contextNote: raw.contextNote }
        : {}),
    });

    if (outcome.mode === "unavailable") {
      return jsonOk(
        {
          imaging: {
            mode: "unavailable" as const,
            observations: [],
            limitations: ["No image analysis was performed."],
            unavailableReason: outcome.reason,
          },
          modelConfiguredForVision: false,
        },
        200,
        API_HEADERS,
      );
    }

    return jsonOk(
      {
        imaging: {
          mode: "model_vision" as const,
          analyzedBy: outcome.audit.model,
          observations: outcome.analysis.observations,
          limitations: [
            "These are AI-generated descriptions of what appeared to be visible. They are not a radiological interpretation.",
            "No radiologist, and no clinician with access to the original study, has reviewed this image.",
            "A language model can miss findings, over-call normal structures, and cannot measure or stage anything reliably.",
          ],
        },
        audit: outcome.audit,
      },
      200,
      API_HEADERS,
    );
  })(request);
}