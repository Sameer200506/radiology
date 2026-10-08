/**
 * GET /api/ai/capabilities
 *
 * Reports what the deployment can actually do, so the UI can tell the truth
 * about image analysis instead of guessing. Returns no secrets — only model ids,
 * which are already public in the OpenRouter catalogue.
 */

import {
  fallbackModel,
  isAiConfigured,
  primaryModel,
  visionModel,
} from "@/lib/ai/models";
import { guardedRoute, jsonOk, API_HEADERS } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async () => {
    const vision = visionModel();

    return jsonOk(
      {
        aiConfigured: isAiConfigured(),
        visionAvailable: isAiConfigured() && vision !== null,
        visionModel: vision,
        primaryModel: primaryModel(),
        fallbackModel: fallbackModel(),
      },
      200,
      API_HEADERS,
    );
  })(request);
}