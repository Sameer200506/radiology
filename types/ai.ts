/**
 * AI-facing types.
 *
 * Structured AI *outputs* are inferred from the Zod schemas in
 * `lib/ai/schemas.ts` rather than hand-written here, so the runtime contract and
 * the compile-time type can never drift. This file holds the primitives the
 * schemas depend on, plus the shared request/response envelopes.
 */

export { QUESTION_TYPES, type QuestionType, QUESTION_IMPORTANCE, type QuestionImportance } from "./ai-primitives";

/** Stage-1 intake output. Re-exported from lib/ai/schemas for convenience. */
export type { IntakeAnalysis } from "@/lib/ai/schemas";

export type AiStage =
  | "intake"
  | "questions"
  | "document"
  | "imaging"
  | "assessment"
  | "report";

/** Uniform error envelope returned by every API route. */
export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_RATE_LIMITED"
  | "AI_QUOTA_EXHAUSTED"
  | "AI_TIMEOUT"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_INVALID_RESPONSE"
  | "AI_PROVIDER_ERROR"
  | "AI_UNSAFE_INPUT"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPLOAD_INVALID"
  | "UPLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface AiErrorBody {
  error: {
    code: AiErrorCode;
    /** Safe, human-readable message. Never contains provider internals. */
    message: string;
    retryable: boolean;
  };
}