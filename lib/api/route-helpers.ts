import "server-only";

import { NextResponse } from "next/server";

import type { AiErrorCode, AiErrorBody } from "@/types/ai";
import { AiError, isAiError, toSafeAiError } from "@/lib/ai/openrouter";
import { RATE_LIMITS, identityFromRequest, rateLimit, type RateLimitName } from "@/lib/security/rate-limit";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * True when the deployment is missing configuration rather than genuinely
 * broken. Surfaced as a 503 with an actionable message instead of a 500, so a
 * setup gap is never mistaken for a bug.
 */
export function isConfigurationError(error: unknown): error is ConfigurationError {
  if (error instanceof ConfigurationError) return true;
  return error instanceof Error && error.name === "ConfigurationError";
}

export function configurationErrorResponse(): NextResponse {
  return jsonError(
    "INTERNAL_ERROR",
    "This deployment is missing required configuration. Please see the README setup guide.",
    503,
    false,
  );
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function jsonOk<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function jsonError(
  code: AiErrorCode,
  message: string,
  status: number,
  retryable = false,
  headers?: HeadersInit,
): NextResponse {
  const body: AiErrorBody = { error: { code, message, retryable } };
  return NextResponse.json(body, { status, headers });
}

/**
 * Translates any thrown value into a safe HTTP response.
 *
 * Provider internals, stack traces and Firestore error text are logged on the
 * server and never serialised to the browser.
 */
export function jsonFromError(error: unknown): NextResponse {
  if (isAiError(error)) {
    return jsonError(error.code, error.message, error.status, error.retryable);
  }

  if (isConfigurationError(error)) {
    console.error("[config]", error.message);
    return configurationErrorResponse();
  }

  /*
   * Firebase permission failures are the single most common misconfiguration
   * once rules are deployed but ownership does not match. That is a setup
   * problem, not a bug, so it gets a 503 with the rule hint rather than a 500
   * that sends the developer hunting through application code.
   */
  if (error instanceof Error && /permission|insufficient|missing or insufficient permissions/i.test(error.message)) {
    console.error("[firestore]", error.message);
    return jsonError(
      "INTERNAL_ERROR",
      "The database rejected that request. Check that Firestore Security Rules are deployed.",
      503,
      false,
    );
  }

  const safe = toSafeAiError(error);
  console.error("[unhandled]", safe.code, safe.internalDetail ?? "");
  return jsonError(safe.code, GENERIC_MESSAGE, 500, true);
}

export type GuardedContext<T> = {
  user: SessionUser;
  request: Request;
  params: T;
};

/**
 * Wraps a route handler with authentication, rate limiting and error handling.
 *
 * Order matters: rate limiting runs before authentication so an unauthenticated
 * flood cannot reach the token verification path.
 */
export function guardedRoute<TParams = Record<string, string>>(
  options: {
    limit?: RateLimitName;
    requireAuth?: boolean;
  },
  handler: (context: GuardedContext<TParams>) => Promise<NextResponse>,
) {
  const requireAuth = options.requireAuth ?? true;
  const limitName = options.limit;

  return async (
    request: Request,
    routeContext?: unknown,
  ): Promise<NextResponse> => {
    let user: SessionUser | null = null;

    if (requireAuth) {
      try {
        user = await getSessionUser();
      } catch {
        user = null;
      }
      if (!user) {
        return jsonError("UNAUTHENTICATED", "Please sign in to continue.", 401, false);
      }
    }

    if (limitName) {
      const result = rateLimit({
        identity: identityFromRequest(request, user?.uid ?? null),
        rule: RATE_LIMITS[limitName],
        scope: limitName,
      });
      if (!result.allowed) {
        return jsonError(
          "RATE_LIMITED",
          `Too many requests. Please wait ${result.retryAfterSeconds} second${result.retryAfterSeconds === 1 ? "" : "s"} and try again.`,
          429,
          true,
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      }
    }

    try {
      // Next 16 provides `params` as a Promise. A plain object is also accepted
      // so the helper stays usable from tests and Server Actions.
      const candidate = (routeContext as { params?: unknown } | null | undefined)?.params;
      const params = (
        candidate && typeof (candidate as Promise<TParams>).then === "function"
          ? await candidate
          : (candidate ?? {})
      ) as TParams;

      return await handler({ user: user as SessionUser, request, params });
    } catch (error) {
      return jsonFromError(error);
    }
  };
}

/** Reads and JSON-parses a request body with a size guard. */
export async function readJsonBody<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const declared = request.headers.get("content-length");
  if (declared && Number.parseInt(declared, 10) > maxBytes) {
    throw new AiError({
      code: "UPLOAD_TOO_LARGE",
      message: "That request was too large.",
      status: 413,
      retryable: false,
    });
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new AiError({
      code: "UPLOAD_TOO_LARGE",
      message: "That request was too large.",
      status: 413,
      retryable: false,
    });
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AiError({
      code: "VALIDATION_ERROR",
      message: "That request could not be read. Please refresh and try again.",
      status: 400,
      retryable: false,
    });
  }
}

/** Standard no-store headers for API responses. */
export const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

/** Security headers applied to authenticated API responses. */
export const API_HEADERS: Record<string, string> = {
  ...NO_STORE,
  "X-Content-Type-Options": "nosniff",
};
