/**
 * GET    /api/ai/connection/chatgpt  — connection status for the signed-in user.
 * DELETE /api/ai/connection/chatgpt  — revoke and forget the connection.
 *
 * Tokens never leave the server: the response contains only account labels and
 * model ids that the Settings card needs.
 */

import {
  clearChatGptConnection,
  readChatGptConnection,
  summariseChatGptConnection,
} from "@/lib/ai/chatgpt-connection";
import { revokeRefreshToken, resolveChatGptOAuthConfig } from "@/lib/ai/chatgpt-oauth";
import { chatGptModel, chatGptVisionModel } from "@/lib/ai/models";
import { guardedRoute, jsonOk, API_HEADERS } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async ({ user, request: req }) => {
    const config = resolveChatGptOAuthConfig(req);
    const connection = await readChatGptConnection(user.uid).catch(() => null);

    return jsonOk(
      {
        configured: config.available,
        available: config.available,
        reason: config.reason,
        clientId: config.clientId,
        ...(connection
          ? {
              ...summariseChatGptConnection(connection),
              model: connection.model ?? chatGptModel(),
              visionModel: connection.visionModel ?? chatGptVisionModel(),
            }
          : {
              connected: false,
              email: null,
              name: null,
              planUsage: false,
              model: null,
              visionModel: null,
              connectedAt: null,
              expiresAt: null,
            }),
      },
      200,
      API_HEADERS,
    );
  })(request);
}

export async function DELETE(request: Request) {
  return guardedRoute({ limit: "session" }, async ({ user }) => {
    const connection = await readChatGptConnection(user.uid).catch(() => null);
    let revoked = false;

    if (connection) {
      revoked = await revokeRefreshToken({
        clientId: connection.clientId,
        refreshToken: connection.refreshToken,
      });
    }

    await clearChatGptConnection();
    return jsonOk({ ok: true, revoked }, 200, API_HEADERS);
  })(request);
}
