import "server-only";

import {
  AiError,
  isAbortError,
  type CompletionOptions,
  type CompletionResult,
  type ContentPart,
} from "@/lib/ai/provider-core";
import { getAiConnection } from "@/lib/ai/context";
import { getChatGptAccessToken } from "@/lib/ai/chatgpt-connection";
import type { ChatGptConnection } from "@/lib/ai/chatgpt-types";
import { CHATGPT_API_BASE_URL, MAX_TOKENS, primaryModel } from "@/lib/ai/models";

/**
 * ChatGPT-plan transport.
 *
 * Uses the public Responses API (`POST https://api.openai.com/v1/responses`)
 * with the user's OAuth access token, exactly as the "Sign in with ChatGPT"
 * plan-usage documentation requires: `store: false`, `stream: true`, and the
 * request is only considered successful after `response.completed`.
 *
 * It is deliberately separate from `openrouter.ts`: the request shape, the
 * streaming protocol and the failure modes are different, and mixing them would
 * make both harder to reason about.
 */

interface ResponsesPayload {
  id?: string;
  model?: string;
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
}

interface StreamEvent {
  type?: string;
  delta?: string;
  text?: string;
  response?: ResponsesPayload;
  error?: { code?: string; message?: string } | null;
  message?: string;
}

function buildInputContent(options: CompletionOptions): unknown {
  if (!options.images || options.images.length === 0) {
    return options.user;
  }

  const content: Array<Record<string, string>> = [
    { type: "input_text", text: options.user },
  ];
  for (const image of options.images) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${image.base64}`,
    });
  }
  return content;
}

function requestBody(
  model: string,
  options: CompletionOptions,
  includeJsonFormat: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    instructions: options.system,
    input: [
      {
        role: "user",
        content: buildInputContent(options),
      },
    ],
    store: false,
    // The plan-usage flow requires streaming. `complete()` collects the deltas;
    // nothing is forwarded to the browser as a live stream.
    stream: true,
    max_output_tokens: options.maxTokens ?? MAX_TOKENS,
  };

  if (includeJsonFormat) {
    body.text = { format: { type: "json_object" } };
  }

  return body;
}

function providerMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const candidate = payload as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
    };
    if (typeof candidate.error?.message === "string") return candidate.error.message;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return fallback;
}

function errorCode(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const candidate = payload as { error?: { code?: unknown }; code?: unknown };
    if (typeof candidate.error?.code === "string") return candidate.error.code;
    if (typeof candidate.code === "string") return candidate.code;
  }
  return "";
}

function classifyHttpFailure(status: number, payload: unknown): AiError {
  const code = errorCode(payload);
  const detail = providerMessage(payload, `HTTP ${status}`).slice(0, 400);
  const usageLimit =
    code === "subscription_sharing_usage_limit_exceeded" ||
    /usage limit|quota/i.test(detail);
  const grantProblem =
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context";
  const notEligible = code === "subscription_sharing_user_not_eligible";
  const unsupported = code === "subscription_sharing_unsupported_capability";
  const routeUnsupported = code === "subscription_sharing_route_not_supported";
  const invalidUser = code === "subscription_sharing_invalid_user";

  if (status === 401 || code === "invalid_api_key" || invalidUser) {
    return new AiError({
      code: "AI_CONNECTION_REQUIRED",
      message:
        "Your ChatGPT connection is no longer valid. Reconnect it in Settings, or disconnect it to use the deployment's AI.",
      status: 401,
      retryable: false,
      internalDetail: `ChatGPT auth failure (${status}): ${detail}`,
    });
  }

  if (status === 403) {
    // Policy and workspace restrictions are not fixed by repeating OAuth.
    if (notEligible) {
      return new AiError({
        code: "AI_PROVIDER_ERROR",
        message:
          "ChatGPT plan usage is not available for this account or workspace. Try a different ChatGPT account, or ask the administrator about access.",
        status: 403,
        retryable: false,
        internalDetail: `ChatGPT user not eligible (403): ${detail}`,
      });
    }

    if (grantProblem) {
      return new AiError({
        code: "AI_CONNECTION_REQUIRED",
        message:
          "ChatGPT did not authorize plan usage for this request. Reconnect ChatGPT in Settings and approve plan usage.",
        status: 401,
        retryable: false,
        internalDetail: `ChatGPT grant problem (${code}): ${detail}`,
      });
    }

    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT declined this request because of a policy or permission restriction. Please contact the administrator of this application.",
      status: 403,
      retryable: false,
      internalDetail: `ChatGPT policy failure (${status}): ${detail}`,
    });
  }

  if (status === 402 || (status === 429 && usageLimit)) {
    return new AiError({
      code: "AI_QUOTA_EXHAUSTED",
      message:
        "Your ChatGPT plan's usage limit for apps has been reached. Wait for it to reset, or disconnect ChatGPT in Settings to use the deployment's AI.",
      status: 503,
      retryable: false,
      internalDetail: `ChatGPT plan usage limit (${status}): ${detail}`,
    });
  }

  if (unsupported) {
    return new AiError({
      code: "AI_MODEL_UNAVAILABLE",
      message:
        "The ChatGPT model selected for this account does not support part of this request. Reconnect ChatGPT in Settings to choose a current model.",
      status: 400,
      retryable: false,
      internalDetail: `ChatGPT unsupported capability (400): ${detail}`,
    });
  }

  if (routeUnsupported) {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT does not support this request route for plan usage. Please contact the administrator of this application.",
      status: 403,
      retryable: false,
      internalDetail: `ChatGPT unsupported route (403): ${detail}`,
    });
  }

  if (status === 429) {
    return new AiError({
      code: "AI_RATE_LIMITED",
      message:
        "ChatGPT is busy right now. Please wait a moment and try again.",
      status: 503,
      retryable: true,
      internalDetail: `ChatGPT rate limit (429): ${detail}`,
    });
  }

  if (status === 404 || status === 400) {
    return new AiError({
      code: "AI_MODEL_UNAVAILABLE",
      message:
        "The ChatGPT model selected for this account is not available. Reconnect ChatGPT in Settings to choose a current model.",
      status: 503,
      retryable: true,
      internalDetail: `ChatGPT model/request error (${status}): ${detail}`,
    });
  }

  if (status === 408 || status === 504) {
    return new AiError({
      code: "AI_TIMEOUT",
      message: "ChatGPT took too long to respond. Please try again.",
      status: 504,
      retryable: true,
      internalDetail: `ChatGPT timeout (${status}): ${detail}`,
    });
  }

  if (status >= 500) {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT is temporarily unavailable. Please try again in a few minutes.",
      status: 503,
      retryable: true,
      internalDetail: `ChatGPT server error (${status}): ${detail}`,
    });
  }

  return new AiError({
    code: "AI_PROVIDER_ERROR",
    message: "ChatGPT could not complete the request. Please try again.",
    status: 502,
    retryable: true,
    internalDetail: `ChatGPT unexpected (${status}): ${detail}`,
  });
}

function classifyStreamFailure(payload: ResponsesPayload): AiError {
  const code = payload.error?.code ?? "";
  const detail = payload.error?.message ?? "ChatGPT response failed.";

  if (code === "subscription_sharing_usage_limit_exceeded") {
    return new AiError({
      code: "AI_QUOTA_EXHAUSTED",
      message:
        "Your ChatGPT plan's usage limit for apps has been reached. Wait for it to reset, or disconnect ChatGPT in Settings to use the deployment's AI.",
      status: 503,
      retryable: false,
      internalDetail: `ChatGPT usage limit: ${detail}`,
    });
  }

  if (
    code === "subscription_sharing_usage_unavailable" ||
    code === "subscription_sharing_user_unavailable"
  ) {
    // The credentials and grant are fine; the plan could not be checked. Retry
    // later rather than sending the user through OAuth again.
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT plan usage could not be checked just now. Please try again in a moment.",
      status: 503,
      retryable: true,
      internalDetail: `ChatGPT plan temporarily unavailable (${code}): ${detail}`,
    });
  }

  if (code === "subscription_sharing_user_not_eligible") {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT plan usage is not available for this account or workspace. Try a different ChatGPT account, or ask the administrator about access.",
      status: 403,
      retryable: false,
      internalDetail: `ChatGPT user not eligible: ${detail}`,
    });
  }

  if (code === "subscription_sharing_unsupported_capability") {
    return new AiError({
      code: "AI_MODEL_UNAVAILABLE",
      message:
        "The ChatGPT model selected for this account does not support part of this request. Reconnect ChatGPT in Settings to choose a current model.",
      status: 400,
      retryable: false,
      internalDetail: `ChatGPT unsupported capability: ${detail}`,
    });
  }

  if (code === "subscription_sharing_invalid_user") {
    return new AiError({
      code: "AI_CONNECTION_REQUIRED",
      message:
        "Your ChatGPT connection is no longer valid. Reconnect it in Settings, or disconnect it to use the deployment's AI.",
      status: 401,
      retryable: false,
      internalDetail: `ChatGPT invalid user: ${detail}`,
    });
  }

  if (
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context"
  ) {
    return new AiError({
      code: "AI_CONNECTION_REQUIRED",
      message:
        "ChatGPT did not authorize plan usage for this request. Reconnect ChatGPT in Settings and approve plan usage.",
      status: 401,
      retryable: false,
      internalDetail: `ChatGPT grant problem (${code}): ${detail}`,
    });
  }

  if (code === "subscription_sharing_route_not_supported") {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "ChatGPT does not support this request route for plan usage. Please contact the administrator of this application.",
      status: 403,
      retryable: false,
      internalDetail: `ChatGPT unsupported route: ${detail}`,
    });
  }

  if (payload.status === "incomplete") {
    return new AiError({
      code: "AI_INVALID_RESPONSE",
      message:
        "The ChatGPT response was cut off before it could be completed. Please try again.",
      status: 502,
      retryable: true,
      internalDetail: `ChatGPT response incomplete: ${payload.incomplete_details?.reason ?? "unknown"}`,
    });
  }

  return new AiError({
    code: "AI_PROVIDER_ERROR",
    message: "ChatGPT could not complete the request. Please try again.",
    status: 502,
    retryable: true,
    internalDetail: `ChatGPT stream failure (${code || "unknown"}): ${detail}`,
  });
}

/** Parses one SSE block into a JSON event. Exported for unit tests. */
export function parseSseData(block: string): StreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;

  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StreamEvent) : null;
  } catch {
    return null;
  }
}

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE uses CRLF or LF. Normalising is safe for JSON payloads.
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseData(block);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }

    const tail = parseSseData(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function textFromResponse(payload: ResponsesPayload): string {
  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("");
}

async function callChatGptOnce(
  connection: ChatGptConnection,
  model: string,
  options: CompletionOptions,
  timeoutMs: number,
  includeJsonFormat: boolean,
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort();
  };
  if (options.signal) {
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(`${CHATGPT_API_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(requestBody(model, options, includeJsonFormat)),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const raw = await response.text();
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }

      // Some models reject `text.format: json_object`. Retry once without the
      // hint; the prompts already ask for JSON and validation still runs. A
      // structured plan-usage error is never a format problem, so never retry it.
      const structuredCode = errorCode(parsed);
      if (
        includeJsonFormat &&
        response.status === 400 &&
        !structuredCode.startsWith("subscription_sharing_") &&
        /json|format|text/i.test(providerMessage(parsed, raw))
      ) {
        return await callChatGptOnce(connection, model, options, timeoutMs, false);
      }

      throw classifyHttpFailure(response.status, parsed);
    }

    if (!response.body) {
      throw new AiError({
        code: "AI_PROVIDER_ERROR",
        message: "ChatGPT returned an empty response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: "ChatGPT response had no body",
      });
    }

    let text = "";
    let completed: ResponsesPayload | null = null;

    for await (const event of readSseEvents(response.body)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        continue;
      }

      if (event.type === "response.output_text.done" && typeof event.text === "string") {
        // Some models send the final text only at the end. Prefer deltas, but
        // use this when no delta arrived.
        if (text.length === 0) text = event.text;
        continue;
      }

      if (event.type === "response.completed") {
        completed = event.response ?? null;
        if (text.length === 0 && completed) text = textFromResponse(completed);
        continue;
      }

      if (event.type === "response.failed" || event.type === "response.incomplete") {
        throw classifyStreamFailure(event.response ?? { status: "failed" });
      }

      if (event.type === "error") {
        throw new AiError({
          code: "AI_PROVIDER_ERROR",
          message: "ChatGPT could not complete the request. Please try again.",
          status: 502,
          retryable: true,
          internalDetail: `ChatGPT stream error: ${event.message ?? event.error?.message ?? "unknown"}`,
        });
      }
    }

    if (!completed) {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message:
          "The ChatGPT response ended before it was complete. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `ChatGPT stream ended without response.completed (${text.length} chars)`,
      });
    }

    if (!text || text.trim().length === 0) {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message: "ChatGPT returned an empty response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Empty ChatGPT response (status=${completed.status ?? "unknown"})`,
      });
    }

    return {
      text,
      model: completed.model ?? model,
      provider: "ChatGPT",
      usedFallback: model !== primaryModel(),
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: completed.usage?.input_tokens,
        completionTokens: completed.usage?.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof AiError) throw error;

    if (isAbortError(error)) {
      const externallyAborted = options.signal?.aborted === true;
      throw new AiError({
        code: "AI_TIMEOUT",
        message: externallyAborted
          ? "The ChatGPT request was cancelled. Please try again."
          : "ChatGPT took too long to respond. Please try again.",
        status: 504,
        retryable: true,
        internalDetail: externallyAborted ? "aborted by caller" : `timeout after ${timeoutMs}ms`,
      });
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "Could not reach ChatGPT. Please check your connection and try again.",
      status: 503,
      retryable: true,
      internalDetail: `network error contacting ChatGPT: ${detail}`,
    });
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Performs one completion using the signed-in user's ChatGPT plan.
 *
 * The caller (`complete()`) owns retries and the fallback model chain; this
 * function makes exactly one HTTP request, plus the one parameter-compatibility
 * retry described above.
 */
export async function callChatGpt(
  model: string,
  options: CompletionOptions,
  timeoutMs: number,
): Promise<CompletionResult> {
  const active = getAiConnection();
  if (!active) {
    throw new AiError({
      code: "AI_CONNECTION_REQUIRED",
      message:
        "Connect your ChatGPT account in Settings to use it for AI analysis.",
      status: 401,
      retryable: false,
      internalDetail: "callChatGpt invoked without an active connection",
    });
  }

  if (!active.planUsage) {
    throw new AiError({
      code: "AI_CONNECTION_REQUIRED",
      message:
        "Your ChatGPT account is connected, but ChatGPT plan usage was not authorized. Reconnect it in Settings and approve plan usage.",
      status: 401,
      retryable: false,
      internalDetail: "ChatGPT connection lacks chatgpt.tokens.use.direct",
    });
  }

  const connection = await getChatGptAccessToken(active);
  return callChatGptOnce(connection, model, options, timeoutMs, true);
}

/** Re-exported so the type is visible to callers that build image parts. */
export type { ContentPart };
