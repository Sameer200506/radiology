/**
 * GET /api/ai/capabilities
 *
 * Reports what the deployment can actually do, so the UI can tell the truth
 * about image analysis instead of guessing. Returns no secrets — only model ids,
 * which are already public in the provider catalogues.
 *
 * The answer is per request: a signed-in user who connected their own ChatGPT
 * plan may have different models (and possibly vision) from the deployment
 * default, so the connection is included explicitly.
 */

import {
  fallbackModel,
  isAiConfigured,
  primaryModel,
  visionModel,
} from "@/lib/ai/models";
import { getAiConnection } from "@/lib/ai/context";
import { guardedRoute, jsonOk, API_HEADERS } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async () => {
    const vision = visionModel();
    const connection = getAiConnection();

    return jsonOk(
      {
        aiConfigured: isAiConfigured(),
        visionAvailable: isAiConfigured() && vision !== null,
        visionModel: vision,
        primaryModel: primaryModel(),
        fallbackModel: fallbackModel(),
        chatgpt: connection
          ? {
              connected: true,
              email: connection.email,
              planUsage: connection.planUsage,
              model: primaryModel(),
            }
          : {
              connected: false,
              email: null,
              planUsage: false,
              model: null,
            },
      },
      200,
      API_HEADERS,
    );
  })(request);
}
