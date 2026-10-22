/**
 * /api/storage/files/[...path] — the local disk storage driver's transport.
 *
 * Implements the three operations the browser SDK would otherwise perform
 * against Firebase Storage, for the `STORAGE_DRIVER=local` development mode:
 *
 *   PUT    /api/storage/files/users/{uid}/{assessmentId}/{fileId}{ext}
 *   GET    ...                     (serves the file back; used for previews)
 *   DELETE ...                     (removes the file)
 *
 * Authorisation is identical to production: the session is verified, and the
 * path must belong to the session's own uid — the same double check that
 * `storage.rules` performs on the real bucket. Every operation is a no-op
 * refusal (404) when the local driver is not enabled, so this route can ship
 * without ever becoming a second, weaker storage API.
 */

import { NextResponse } from "next/server";

import { guardedRoute, jsonError, jsonOk, API_HEADERS } from "@/lib/api/route-helpers";
import { MAX_FILE_BYTES } from "@/lib/uploads/limits";
import {
  contentTypeForLocalFile,
  deleteLocalFile,
  localStorageDriverEnabled,
  parseLocalStoragePath,
  readLocalFile,
  saveLocalFile,
} from "@/lib/storage/local-driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  path: string[];
}

function storagePathFrom(params: RouteParams): string {
  return (params.path ?? []).join("/");
}

function localDriverDisabled() {
  return jsonError(
    "NOT_FOUND",
    "Local test storage is not enabled on this deployment.",
    404,
    false,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  return guardedRoute<RouteParams>({ limit: "session" }, async ({ user, params }) => {
    if (!localStorageDriverEnabled()) return localDriverDisabled();

    const storagePath = storagePathFrom(params);
    if (!parseLocalStoragePath(storagePath, user.uid)) {
      return jsonError("NOT_FOUND", "That file does not exist.", 404, false);
    }

    const bytes = await readLocalFile(storagePath, user.uid);
    if (!bytes) {
      return jsonError("NOT_FOUND", "That file does not exist.", 404, false);
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...API_HEADERS,
        "Content-Type": contentTypeForLocalFile(storagePath),
        "Content-Length": String(bytes.byteLength),
      },
    });
  })(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  return guardedRoute<RouteParams>({ limit: "upload" }, async ({ user, request: req, params }) => {
    if (!localStorageDriverEnabled()) return localDriverDisabled();

    const storagePath = storagePathFrom(params);
    if (!parseLocalStoragePath(storagePath, user.uid)) {
      return jsonError(
        "VALIDATION_ERROR",
        "That storage path is not valid for this account.",
        400,
        false,
      );
    }

    const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      return jsonError("UPLOAD_TOO_LARGE", "That file is larger than the 10 MB limit.", 413, false);
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      return jsonError("VALIDATION_ERROR", "The upload was empty. Please try again.", 400, false);
    }
    if (body.byteLength > MAX_FILE_BYTES) {
      return jsonError("UPLOAD_TOO_LARGE", "That file is larger than the 10 MB limit.", 413, false);
    }

    const written = await saveLocalFile(storagePath, user.uid, new Uint8Array(body));
    return jsonOk({ ok: true, path: storagePath, bytes: written }, 200, API_HEADERS);
  })(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  return guardedRoute<RouteParams>({ limit: "upload" }, async ({ user, params }) => {
    if (!localStorageDriverEnabled()) return localDriverDisabled();

    const storagePath = storagePathFrom(params);
    if (!parseLocalStoragePath(storagePath, user.uid)) {
      return jsonError(
        "VALIDATION_ERROR",
        "That storage path is not valid for this account.",
        400,
        false,
      );
    }

    await deleteLocalFile(storagePath, user.uid);
    return jsonOk({ ok: true }, 200, API_HEADERS);
  })(request, context);
}
