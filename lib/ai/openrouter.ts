/**
 * Centralised AI provider client.
 *
 * Every model call in the application goes through this module. It owns:
 *   - the provider keys (server-side only; this file must never be imported by
 *     a client component)
 *   - provider selection: Google Gemini when GEMINI_API_KEY is set (works on
 *     networks where openrouter.ai is unreachable), OpenRouter otherwise
 *   - model selection and the primary -> fallback chain
 *   - timeouts, retry/backoff, and retryable-error classification
 *   - structured-output parsing, Zod validation, and a single repair attempt
 *   - the mapping of every provider failure onto a safe, user-facing error
 *
 * Provider error bodies are logged to stderr in development and never returned
 * to the browser.
 */

import "server-only";

import { z } from "zod";
import type { z as ZodNamespace } from "zod";

import {
  MAX_TOKENS,
  OPENROUTER_BASE_URL,
  REQUEST_TIMEOUT_MS,
  activeProvider,
  describeModel,
  isAiConfigured,
  modelChain,
  primaryModel,
} from "@/lib/ai/models";
import { extractJson } from "@/lib/ai/extract-json";
import { callGemini } from "@/lib/ai/gemini";
import {
  AiError,
  isAbortError,
  toSafeAiError,
  type CompletionOptions,
  type CompletionResult,
  type ContentPart,
  type TextPart,
} from "@/lib/ai/provider-core";

/*
 * Public re-exports keep the module boundary stable: routes, stages and tests
 * import AiError, CompletionOptions and friends from this module regardless of
 * which transport answers.
 */
export { AiError, isAiError, toSafeAiError } from "@/lib/ai/provider-core";
export type {
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  CompletionUsage,
  ContentPart,
  ImagePart,
  MessageRole,
  TextPart,
} from "@/lib/ai/provider-core";

/* ------------------------------------------------------------------ *
 * Provider plumbing
 * ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface OpenRouterChoice {
  message?: { content?: string | Array<{ type?: string; text?: string }> | null };
  finish_reason?: string | null;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  provider?: string;
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number | string } | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Classifies an HTTP failure from OpenRouter into a safe, actionable error. */
function classifyHttpFailure(status: number, providerMessage: string): AiError {
  const detail = providerMessage.slice(0, 400);

  if (status === 401 || status === 403) {
    return new AiError({
      code: "AI_NOT_CONFIGURED",
      message:
        "The AI service is not correctly configured. Please contact the administrator of this application.",
      status: 503,
      retryable: false,
      internalDetail: `OpenRouter auth failure (${status}): ${detail}`,
    });
  }

  if (status === 402) {
    return new AiError({
      code: "AI_QUOTA_EXHAUSTED",
      message:
        "The AI service has reached its usage limit for now. Please try again later, or contact the administrator of this application.",
      status: 503,
      retryable: true,
      internalDetail: `OpenRouter quota (402): ${detail}`,
    });
  }

  if (status === 429) {
    return new AiError({
      code: "AI_RATE_LIMITED",
      message:
        "The AI service is busy right now because many people are using it. Please wait a moment and try again.",
      status: 503,
      retryable: true,
      internalDetail: `OpenRouter rate limit (429): ${detail}`,
    });
  }

  if (status === 404 || status === 400) {
    // 400/404 from OpenRouter is overwhelmingly an unavailable or retired model
    // on the free tier. The fallback chain handles it when one is configured.
    return new AiError({
      code: "AI_MODEL_UNAVAILABLE",
      message:
        "The AI model is currently unavailable. The application will try an alternative model.",
      status: 503,
      retryable: true,
      internalDetail: `OpenRouter model unavailable (${status}): ${detail}`,
    });
  }

  if (status === 408 || status === 504) {
    return new AiError({
      code: "AI_TIMEOUT",
      message: "The AI service took too long to respond. Please try again.",
      status: 504,
      retryable: true,
      internalDetail: `OpenRouter timeout (${status}): ${detail}`,
    });
  }

  if (status >= 500) {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "The AI service is temporarily unavailable. Please try again in a few minutes.",
      status: 503,
      retryable: true,
      internalDetail: `OpenRouter server error (${status}): ${detail}`,
    });
  }

  return new AiError({
    code: "AI_PROVIDER_ERROR",
    message: "The AI service could not complete the request. Please try again.",
    status: 502,
    retryable: true,
    internalDetail: `OpenRouter unexpected (${status}): ${detail}`,
  });
}

function buildContent(options: CompletionOptions): string | ContentPart[] {
  const textParts: ContentPart[] = [{ type: "text", text: options.user }];

  if (options.images && options.images.length > 0) {
    for (const image of options.images) {
      textParts.push({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
      });
    }
  }

  return textParts.length === 1 && options.images === undefined
    ? (textParts[0] as TextPart).text
    : textParts;
}

async function callOpenRouter(
  model: string,
  options: CompletionOptions,
  timeoutMs: number,
): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new AiError({
      code: "AI_NOT_CONFIGURED",
      message:
        "AI analysis is not configured on this deployment. Please contact the administrator.",
      status: 503,
      retryable: false,
      internalDetail: "OPENROUTER_API_KEY is not set",
    });
  }

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
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://medassist-ai.vercel.app",
        "X-Title": "MedAssist AI",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: buildContent(options) },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? MAX_TOKENS,
        // Ask the provider for JSON; we still validate, but this improves the odds.
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const rawText = await response.text();
    let parsed: OpenRouterResponse | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as OpenRouterResponse) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const providerMessage =
        parsed?.error?.message ?? rawText.slice(0, 300) ?? `HTTP ${response.status}`;
      throw classifyHttpFailure(response.status, providerMessage);
    }

    if (!parsed) {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message: "The AI service returned an unreadable response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Non-JSON body from provider: ${rawText.slice(0, 200)}`,
      });
    }

    if (parsed.error) {
      throw classifyHttpFailure(
        typeof parsed.error.code === "number" ? parsed.error.code : 500,
        parsed.error.message ?? "unknown provider error",
      );
    }

    const choice = parsed.choices?.[0];
    const rawContent = choice?.message?.content;
    const text =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((part) => (typeof part.text === "string" ? part.text : ""))
              .join("")
          : "";

    if (!text || text.trim().length === 0) {
      const finishReason = choice?.finish_reason ?? "unknown";
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message:
          finishReason === "length"
            ? "The AI response was cut off before it could be completed. Please try again."
            : "The AI service returned an empty response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Empty content (finish_reason=${finishReason}) from ${parsed.model ?? model}`,
      });
    }

    /*
     * A response truncated by the token limit is structurally incomplete even
     * though its text is non-empty — most often it is a half-written JSON object.
     * Detecting this here produces an honest "output too long" error instead of a
     * confusing "could not be parsed", and the caller can raise the budget.
     */
    if (choice?.finish_reason === "length") {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message:
          "The AI response was longer than the configured limit and was cut off. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Truncated by token limit from ${parsed.model ?? model}: ${text.length} chars received`,
      });
    }

    return {
      text,
      model: parsed.model ?? model,
      provider: parsed.provider ?? describeModel(model).label,
      usedFallback: model !== primaryModel(),
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens,
        completionTokens: parsed.usage?.completion_tokens,
      },
    };
  } catch (error) {
    if (error instanceof AiError) throw error;

    if (isAbortError(error)) {
      const externallyAborted = options.signal?.aborted === true;
      throw new AiError({
        code: externallyAborted ? "AI_TIMEOUT" : "AI_TIMEOUT",
        message: externallyAborted
          ? "The request was cancelled. Please try again."
          : "The AI service took too long to respond. Please try again.",
        status: 504,
        retryable: true,
        internalDetail: externallyAborted ? "aborted by caller" : `timeout after ${timeoutMs}ms`,
      });
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "The AI service could not be reached. Please check your connection and try again.",
      status: 503,
      retryable: true,
      internalDetail: `network error contacting OpenRouter: ${detail}`,
    });
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Dispatches to the provider chosen by configuration. A Gemini key always
 * wins when present; otherwise the OpenRouter transport is used.
 */
function callProvider(
  model: string,
  options: CompletionOptions,
  timeoutMs: number,
): Promise<CompletionResult> {
  return activeProvider() === "gemini"
    ? callGemini(model, options, timeoutMs)
    : callOpenRouter(model, options, timeoutMs);
}

/**
 * Perform a completion, walking the configured model chain.
 *
 * Retry policy is intentionally conservative because the free tier is shared:
 * one immediate retry per model for retryable failures, then the fallback model.
 */
export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  if (!isAiConfigured()) {
    throw new AiError({
      code: "AI_NOT_CONFIGURED",
      message:
        "AI analysis is not configured on this deployment. Please contact the administrator, or use the demo mode to explore the workflow.",
      status: 503,
      retryable: false,
      internalDetail:
        activeProvider() === "gemini" ? "GEMINI_API_KEY missing" : "OPENROUTER_API_KEY missing",
    });
  }

  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const chain = options.modelOverride
    ? [options.modelOverride]
    : modelChain();

  let lastError: AiError | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await callProvider(model, options, timeoutMs);
      } catch (error) {
        const aiError = toSafeAiError(error);
        lastError = aiError;

        const worthRetrying =
          aiError.retryable &&
          (aiError.code === "AI_RATE_LIMITED" ||
            aiError.code === "AI_PROVIDER_ERROR" ||
            aiError.code === "AI_TIMEOUT" ||
            // Transient model-side failures: the model exists but is momentarily
            // overloaded (Gemini 503 high-demand) or rolled (404 during a model
            // migration). The fallback model in the chain is tried anyway; this
            // just gives the primary one more chance after a short backoff.
            aiError.code === "AI_MODEL_UNAVAILABLE" ||
            aiError.code === "AI_INVALID_RESPONSE");

        if (!worthRetrying || attempt === 1) break;

        // Jittered exponential backoff. Rate limits get a longer pause.
        const base = aiError.code === "AI_RATE_LIMITED" ? 1_200 : 400;
        const delay = base * 2 ** attempt + Math.floor(Math.random() * 300);
        await sleep(Math.min(delay, 5_000));
      }
    }
  }

  throw (
    lastError ??
    new AiError({
      code: "AI_PROVIDER_ERROR",
      message: "The AI service is unavailable. Please try again later.",
      status: 503,
      retryable: true,
    })
  );
}


/** Re-exported so callers and tests can import JSON extraction from one place. */
export { extractJson, JsonExtractionError } from "@/lib/ai/extract-json";

export interface ValidatedCompletion<T> {
  data: T;
  completion: CompletionResult;
  /** True when the first attempt failed validation and the repair call fixed it. */
  repaired: boolean;
}

/**
 * Completion + validation + at most one repair attempt.
 *
 * Fails closed: if the repaired output is still invalid, an AiError is thrown and
 * no partial or malformed medical data is ever rendered.
 */
export async function completeValidated<T>(
  schema: ZodNamespace.ZodType<T>,
  options: CompletionOptions & {
    /** Describes the expected shape, appended to the repair request. */
    repairHint?: string;
    /**
     * Applied to the parsed candidate BEFORE validation. Used to re-frame
     * structurally-wrong-but-otherwise-valid output (for example a list of
     * strings where objects were expected) so a shape mismatch does not discard
     * an entire assessment. Must not add clinical content.
     */
    coerce?: (candidate: unknown) => unknown;
    /** Applied to the validated data before it is returned. */
    transform?: (data: T) => T;
  },
): Promise<ValidatedCompletion<T>> {
  const completion = await complete(options);

  const first = safeParse(schema, completion.text, options.coerce);
  if (first.ok) {
    const data = options.transform ? options.transform(first.data) : first.data;
    return { data, completion, repaired: false };
  }

  // One repair attempt. Free-tier friendly: this happens rarely. The cap must
  // stay above the largest stage budget (assessment 6_144): capping lower than
  // the original request guarantees the repair truncates exactly like the
  // response it is trying to fix.
  const repaired = await complete({
    ...options,
    temperature: 0,
    maxTokens: Math.min((options.maxTokens ?? MAX_TOKENS) + 512, 8_192),
    system: `${options.system}\n\nYour previous response could not be parsed: ${first.issueSummary}. Return valid JSON only.`,
    user: `Your previous response was:

<INVALID_MODEL_OUTPUT>
${completion.text.slice(0, 6_000)}
</INVALID_MODEL_OUTPUT>

The output failed validation. ${options.repairHint ?? "Check every key, every type and every enum value against the required schema."}

Return the corrected JSON object and nothing else.`,
  });

  const second = safeParse(schema, repaired.text, options.coerce);
  if (second.ok) {
    const data = options.transform ? options.transform(second.data) : second.data;
    return { data, completion: { ...repaired, usedFallback: repaired.usedFallback || completion.usedFallback }, repaired: true };
  }

  throw new AiError({
    code: "AI_INVALID_RESPONSE",
    message:
      "The AI service returned a response that could not be validated, so no assessment is being shown. Please try again.",
    status: 502,
    retryable: true,
    internalDetail: `Validation failed after repair. First: ${first.issueSummary} | Second: ${second.issueSummary}`,
  });
}

type SafeParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; issueSummary: string };

function safeParse<T>(
  schema: ZodNamespace.ZodType<T>,
  text: string,
  coerce?: (candidate: unknown) => unknown,
): SafeParseResult<T> {
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch {
    return { ok: false, issueSummary: "response was not JSON" };
  }

  if (coerce) {
    try {
      candidate = coerce(candidate);
    } catch {
      // A coercing function that throws must not mask the underlying parse
      // failure; fall through and let Zod reject the original candidate.
    }
  }

  const result = schema.safeParse(candidate);
  if (result.success) return { ok: true, data: result.data };

  const issues = result.error.issues.slice(0, 5).map((issue: z.core.$ZodIssue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, issueSummary: issues.join(" | ") || "schema mismatch" };
}

/** Convenience predicate for a configured deployment. */
export function aiReady(): boolean {
  return isAiConfigured();
}
