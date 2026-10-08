"use client";

/**
 * Browser-side API client.
 *
 * Wraps fetch so every call gets the same error shape, the same timeout, and the
 * same JSON handling. The server already returns safe messages, so surfacing
 * `error.message` here is safe by construction.
 */

import type { AiErrorCode, AiErrorBody } from "@/types/ai";

export class ApiRequestError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function request<T>(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      credentials: "same-origin",
      cache: "no-store",
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const body = payload as AiErrorBody | null;
      throw new ApiRequestError(
        body?.error?.code ?? "INTERNAL_ERROR",
        body?.error?.message ??
          (response.status === 401
            ? "Please sign in to continue."
            : "Something went wrong. Please try again."),
        response.status,
        body?.error?.retryable ?? response.status >= 500,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiRequestError(
        "AI_TIMEOUT",
        "That took too long and was cancelled. You can try again.",
        408,
        true,
      );
    }

    throw new ApiRequestError(
      "INTERNAL_ERROR",
      "Could not reach the server. Check your connection and try again.",
      0,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>(url, { ...init, method: "GET" }),
  post: <T>(url: string, body?: unknown, init?: RequestInit) =>
    request<T>(url, {
      ...init,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(url: string, body?: unknown, init?: RequestInit) =>
    request<T>(url, {
      ...init,
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(url: string, body?: unknown, init?: RequestInit) =>
    request<T>(url, {
      ...init,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(url: string, init?: RequestInit) => request<T>(url, { ...init, method: "DELETE" }),
  upload: <T>(url: string, form: FormData, init?: RequestInit & { timeoutMs?: number }) =>
    request<T>(url, { ...init, method: "POST", body: form }),
};

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiRequestError ? error.retryable : true;
}

export function errorCode(error: unknown): string {
  return error instanceof ApiRequestError ? error.code : "INTERNAL_ERROR";
}