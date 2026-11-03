/**
 * GET /api/ai/connection/chatgpt/complete?handoff=...
 *
 * Consumes the single-use hand-off created by the loopback callback and writes
 * the encrypted connection cookie on the app origin, where the Firebase session
 * cookie actually exists.
 */

import {
  readChatGptConnection,
  writeChatGptConnection,
} from "@/lib/ai/chatgpt-connection";
import { takeConnectionHandoff } from "@/lib/ai/chatgpt-handoff";
import { settingsRedirect } from "@/lib/ai/chatgpt-redirect";
import { revokeRefreshToken } from "@/lib/ai/chatgpt-oauth";
import { isSecureRequest } from "@/lib/auth/session";
import { guardedRoute } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async ({ user, request: req }) => {
    const handoff = new URL(req.url).searchParams.get("handoff") ?? "";
    const connection = takeConnectionHandoff(handoff);
    const appOrigin = new URL(req.url).origin;

    if (!connection || connection.uid !== user.uid) {
      return settingsRedirect(appOrigin, "error", "handoff_failed");
    }

    const previous = await readChatGptConnection(user.uid).catch(() => null);
    if (previous && previous.refreshToken !== connection.refreshToken) {
      await revokeRefreshToken({
        clientId: previous.clientId,
        refreshToken: previous.refreshToken,
      }).catch(() => undefined);
    }

    await writeChatGptConnection(connection, isSecureRequest(req));
    return settingsRedirect(appOrigin, "connected");
  })(request);
}
