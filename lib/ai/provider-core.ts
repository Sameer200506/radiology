import "server-only";

/**
 * Provider-agnostic contracts shared by every AI transport.
 *
 * `lib/ai/openrouter.ts` (OpenRouter transport) and `lib/ai/gemini.ts`
 * (Google Gemini transport) both speak these types, so the pipeline in
 * `lib/ai/stages.ts` never has to know which provider answered. Routes import
 * `AiError`, `CompletionOptions` and friends from `@/lib/ai/openrouter`, which
 * re-exports everything from here — the module boundary is unchanged.
 */

import type { AiErrorCode, AiErrorBody } from "@/types/ai";

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  /** Never sent to the client. Kept for server-side logging only. */
  readonly internalDetail?: string;

  constructor(params: {
    code: AiErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    internalDetail?: string;
  }) {
    super(params.message);
    this.name = "AiError";
    this.code = params.code;
    this.status = params.status;
    this.retryable = params.retryable;
    this.internalDetail = params.internalDetail;
  }

  toBody(): AiErrorBody {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}

/**
 * Converts any thrown value into an AiError with a safe message.
 * Unknown errors never leak their message to the browser.
 */
export function toSafeAiError(error: unknown): AiError {
  if (isAiError(error)) return error;
  return new AiError({
    code: "INTERNAL_ERROR",
    message:
      "Something went wrong while analysing your information. Please try again in a moment.",
    status: 500,
    retryable: true,
    internalDetail: error instanceof Error ? error.message : String(error),
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/* ------------------------------------------------------------------ *
 * Request / result shapes
 * ------------------------------------------------------------------ */

export type MessageRole = "system" | "user" | "assistant";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: {
    /** A data: URL or an https URL. */
    url: string;
  };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
}

export interface CompletionOptions {
  system: string;
  user: string;
  /** Optional image parts for vision-capable models. */
  images?: Array<{ base64: string; mimeType: string }>;
  maxTokens?: number;
  temperature?: number;
  /** Overrides the model chain for this call (e.g. vision stage). */
  modelOverride?: string;
  /** Aborts the call after this many ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CompletionResult {
  /** Raw text content from the model. */
  text: string;
  model: string;
  provider: string;
  usedFallback: boolean;
  latencyMs: number;
  usage: CompletionUsage;
}
