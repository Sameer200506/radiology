/**
 * GET /api/storage/status
 *
 * Tells the browser which storage driver this deployment uses, so uploads,
 * previews and deletes go to the right place. Guarded like every other
 * authenticated API: only a signed-in user needs this answer.
 */

import { guardedRoute, jsonOk, API_HEADERS } from "@/lib/api/route-helpers";
import { localStorageDriverEnabled } from "@/lib/storage/local-driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return guardedRoute({ limit: "session" }, async () => {
    return jsonOk(
      { driver: localStorageDriverEnabled() ? "local" : "firebase" },
      200,
      API_HEADERS,
    );
  })(request);
}
