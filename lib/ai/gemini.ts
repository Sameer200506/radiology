import "server-only";

/**
 * Google Gemini transport (generativelanguage.googleapis.com).
 *
 * Speaks the same contract as the OpenRouter transport in `lib/ai/openrouter.ts`
 * and maps every provider failure onto the same safe AiError codes, so the
 * pipeline cannot tell the difference. Selected automatically in `complete()`
 * whenever GEMINI_API_KEY is present — that makes the AI work on networks where
 * openrouter.ai is unreachable (the fallback chain already covers deployments
 * where it is).
 */

import { GEMINI_BASE_URL, MAX_TOKENS, describeModel, primaryModel } from "@/lib/ai/models";
import {
  AiError,
  isAbortError,
  type CompletionOptions,
  type CompletionResult,
} from "@/lib/ai/provider-core";

interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/** Classifies an HTTP failure from Gemini into a safe, actionable error. */
function classifyGeminiFailure(status: number, providerMessage: string): AiError {
  const detail = providerMessage.slice(0, 400);

  if (status === 401 || status === 403) {
    return new AiError({
      code: "AI_NOT_CONFIGURED",
      message:
        "The AI service is not correctly configured. Please contact the administrator of this application.",
      status: 503,
      retryable: false,
      internalDetail: `Gemini auth failure (${status}): ${detail}`,
    });
  }

  if (status === 429) {
    return new AiError({
      code: "AI_RATE_LIMITED",
      message:
        "The AI service is busy right now because many people are using it. Please wait a moment and try again.",
      status: 503,
      retryable: true,
      internalDetail: `Gemini rate limit (429): ${detail}`,
    });
  }

  if (status === 404 || status === 400) {
    // Overwhelmingly "this model id does not exist / is not enabled" — the
    // fallback chain should try the next model.
    return new AiError({
      code: "AI_MODEL_UNAVAILABLE",
      message:
        "The AI model is currently unavailable. The application will try an alternative model.",
      status: 503,
      retryable: true,
      internalDetail: `Gemini model unavailable (${status}): ${detail}`,
    });
  }

  if (status === 408 || status === 504) {
    return new AiError({
      code: "AI_TIMEOUT",
      message: "The AI service took too long to respond. Please try again.",
      status: 504,
      retryable: true,
      internalDetail: `Gemini timeout (${status}): ${detail}`,
    });
  }

  if (status >= 500) {
    return new AiError({
      code: "AI_PROVIDER_ERROR",
      message:
        "The AI service is temporarily unavailable. Please try again in a few minutes.",
      status: 503,
      retryable: true,
      internalDetail: `Gemini server error (${status}): ${detail}`,
    });
  }

  return new AiError({
    code: "AI_PROVIDER_ERROR",
    message: "The AI service could not complete the request. Please try again.",
    status: 502,
    retryable: true,
    internalDetail: `Gemini unexpected (${status}): ${detail}`,
  });
}

export async function callGemini(
  model: string,
  options: CompletionOptions,
  timeoutMs: number,
): Promise<CompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiError({
      code: "AI_NOT_CONFIGURED",
      message:
        "AI analysis is not configured on this deployment. Please contact the administrator.",
      status: 503,
      retryable: false,
      internalDetail: "GEMINI_API_KEY is not set",
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
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

  // Gemini reads images as inline base64 parts — no data-URL rewriting needed.
  const parts: GeminiPart[] = [{ text: options.user }];
  for (const image of options.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? MAX_TOKENS,
          // Ask the model for JSON; we still validate, but this improves the odds.
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const rawText = await response.text();
    let parsed: GeminiResponse | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as GeminiResponse) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const body = (parsed ?? {}) as GeminiErrorBody;
      const providerMessage = body.error?.message ?? rawText.slice(0, 300) ?? `HTTP ${response.status}`;
      throw classifyGeminiFailure(response.status, providerMessage);
    }

    if (!parsed) {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message: "The AI service returned an unreadable response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Non-JSON body from Gemini: ${rawText.slice(0, 200)}`,
      });
    }

    if (parsed.error) {
      throw classifyGeminiFailure(
        parsed.error.code ?? 500,
        parsed.error.message ?? "unknown provider error",
      );
    }

    if (parsed.promptFeedback?.blockReason) {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message: "The AI service declined to process this request. Please try again.",
        status: 502,
        retryable: false,
        internalDetail: `Gemini blocked the prompt (${parsed.promptFeedback.blockReason})`,
      });
    }

    const candidate = parsed.candidates?.[0];
    const rawContent =
      candidate?.content?.parts
        ?.map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("") ?? "";
    const finishReason = candidate?.finishReason ?? "unknown";

    if (!rawContent.trim()) {
      const blocked = !["STOP", "MAX_TOKENS", "unknown"].includes(finishReason);
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message: blocked
          ? "The AI service declined to process this request. Please try again."
          : finishReason === "MAX_TOKENS"
            ? "The AI response was cut off before it could be completed. Please try again."
            : "The AI service returned an empty response. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Empty content (finishReason=${finishReason}) from ${model}`,
      });
    }

    /*
     * A response truncated by the token limit is structurally incomplete even
     * though its text is non-empty — most often it is a half-written JSON
     * object. Detect it here for the same honest error as the OpenRouter path.
     */
    if (finishReason === "MAX_TOKENS") {
      throw new AiError({
        code: "AI_INVALID_RESPONSE",
        message:
          "The AI response was longer than the configured limit and was cut off. Please try again.",
        status: 502,
        retryable: true,
        internalDetail: `Truncated by token limit from ${model}: ${rawContent.length} chars received`,
      });
    }

    return {
      text: rawContent,
      model,
      provider: describeModel(model).label,
      usedFallback: model !== primaryModel(),
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: parsed.usageMetadata?.promptTokenCount,
        completionTokens: parsed.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (error) {
    if (error instanceof AiError) throw error;

    if (isAbortError(error)) {
      const externallyAborted = options.signal?.aborted === true;
      throw new AiError({
        code: "AI_TIMEOUT",
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
      internalDetail: `network error contacting Gemini: ${detail}`,
    });
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
