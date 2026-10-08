/**
 * Primitives shared by the Zod schemas and the TypeScript domain model.
 *
 * Kept in its own module so `lib/ai/schemas.ts` can depend on the runtime
 * constants without creating an import cycle back through `types/ai.ts`.
 */

/** Question kinds the UI knows how to render. */
export const QUESTION_TYPES = [
  "yes_no",
  "single_choice",
  "multiple_choice",
  "number",
  "temperature",
  "text",
  "duration",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_IMPORTANCE = ["high", "medium", "low"] as const;

export type QuestionImportance = (typeof QUESTION_IMPORTANCE)[number];

export interface QuestionOption {
  value: string;
  label: string;
}

/** A follow-up question as rendered by the wizard. */
export interface MedicalQuestion {
  id: string;
  question: string;
  type: QuestionType;
  importance: QuestionImportance;
  /** Why this question was asked — shown as a subtle hint. */
  rationale?: string;
  options?: QuestionOption[];
  /** Unit hint for numeric types. */
  unit?: string;
  placeholder?: string;
}