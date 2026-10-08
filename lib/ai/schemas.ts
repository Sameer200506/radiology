/**
 * Zod schemas for every structured AI response.
 *
 * Nothing the model returns is trusted. Each stage declares its contract here;
 * openrouter.ts validates against these schemas, attempts one repair, and then
 * fails closed. The schemas are intentionally strict about *shape* and
 * deliberately lenient about medical content — the safety posture comes from
 * prompts and the deterministic triage layer, not from rejecting sentences.
 */

import { z } from "zod";

import { QUESTION_IMPORTANCE, QUESTION_TYPES } from "@/types/ai-primitives";
import { URGENCY_LEVELS } from "@/types/medical";

/* ------------------------------------------------------------------ *
 * Shared primitives
 * ------------------------------------------------------------------ */

/** A non-empty, bounded, control-character-free string. */
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/, "contains control characters");

const shortText = (max = 400) => text(1, max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);

export const urgencyLevelSchema = z.enum(URGENCY_LEVELS);

/**
 * Free clinical text is never rendered as-is without being length bounded,
 * but we do not attempt to judge its medical correctness here.
 */
const clinicalText = (max = 1_200) => text(1, max);

/* ------------------------------------------------------------------ *
 * Stage 1 — Intake
 * ------------------------------------------------------------------ */

export const intakeAnalysisSchema = z.object({
  symptoms: list(shortText(120), 25),
  duration: z.string().trim().max(200).default(""),
  severity: z.string().trim().max(200).default(""),
  associatedSymptoms: list(shortText(120), 25),
  riskFactors: list(shortText(200), 15),
  missingInformation: list(shortText(200), 15),
  redFlags: list(shortText(200), 15),
});
export type IntakeAnalysisOutput = z.infer<typeof intakeAnalysisSchema>;

/* ------------------------------------------------------------------ *
 * Stage 2 — Dynamic questions
 * ------------------------------------------------------------------ */

export const questionOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
});

export const medicalQuestionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9_]+$/, "question ids must be lowercase snake_case"),
    question: shortText(300),
    type: z.enum(QUESTION_TYPES),
    importance: z.enum(QUESTION_IMPORTANCE),
    rationale: z.string().trim().max(300).optional(),
    options: list(questionOptionSchema, 12).optional(),
    unit: z.string().trim().max(40).optional(),
    placeholder: z.string().trim().max(160).optional(),
  })
  .superRefine((question, ctx) => {
    const needsOptions =
      question.type === "single_choice" || question.type === "multiple_choice";
    if (needsOptions && (!question.options || question.options.length < 2)) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "choice questions need at least two options",
      });
    }
  });

export const questionsPayloadSchema = z.object({
  questions: list(medicalQuestionSchema, 8).min(1, "at least one question is required"),
  rationale: z.string().trim().max(600).default(""),
});
export type QuestionsPayloadOutput = z.infer<typeof questionsPayloadSchema>;

/* ------------------------------------------------------------------ *
 * Stage 3 — Document analysis
 * ------------------------------------------------------------------ */

const findingStatusSchema = z.enum([
  "within_reference_range",
  "below_reference_range",
  "above_reference_range",
  "abnormal_flagged_by_report",
  "indeterminate",
  "not_stated",
]);

const documentFindingSchema = z.object({
  test: shortText(160),
  value: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  referenceRange: z.string().trim().max(80).optional(),
  status: findingStatusSchema,
  evidence: z.string().trim().max(400).optional(),
  note: z.string().trim().max(400).optional(),
});

const documentTypeSchema = z.enum([
  "blood_test",
  "radiology_report",
  "pathology_report",
  "prescription",
  "discharge_summary",
  "imaging_image",
  "other",
  "unknown",
]);

export const documentAnalysisSchema = z.object({
  documentType: documentTypeSchema,
  title: z.string().trim().max(200).optional(),
  findings: list(documentFindingSchema, 60),
  impression: z.string().trim().max(2_000).optional(),
  /** Only recommendations that literally appear in the source document. */
  reportRecommendations: list(text(1, 500), 15),
  warnings: list(text(1, 400), 10),
});
export type DocumentAnalysisOutput = z.infer<typeof documentAnalysisSchema>;

/* ------------------------------------------------------------------ *
 * Stage 4 — Imaging observations
 * ------------------------------------------------------------------ */

export const imagingAnalysisSchema = z.object({
  observations: list(
    z.object({
      observation: clinicalText(600),
      uncertainty: z.enum(["low", "moderate", "high"]),
      evidence: shortText(500),
      limitations: list(shortText(200), 6),
    }),
    12,
  ),
});
export type ImagingAnalysisOutput = z.infer<typeof imagingAnalysisSchema>;

/* ------------------------------------------------------------------ *
 * Stage 5 — Final assessment
 * ------------------------------------------------------------------ */

const keyFindingSchema = z.object({
  title: shortText(160),
  detail: clinicalText(800),
  source: z.enum(["symptoms", "answers", "document", "imaging", "demographics", "history"]),
});

const symptomAnalysisItemSchema = z.object({
  symptom: shortText(160),
  interpretation: clinicalText(800),
  severityNote: z.string().trim().max(400).optional(),
  durationNote: z.string().trim().max(400).optional(),
});

const possibleExplanationSchema = z.object({
  rank: z.number().int().min(1).max(5),
  explanation: shortText(200),
  whyItMayFit: list(shortText(300), 8).min(1, "an explanation must say why it may fit"),
  whatWouldTestIt: list(shortText(300), 6),
  confidenceNote: shortText(300),
});

const redFlagFindingSchema = z.object({
  flag: shortText(200),
  why: clinicalText(600),
  source: z.enum(["deterministic_rule", "ai_identified", "user_stated"]),
  severity: z.enum(["escalate", "urgent_review", "monitor"]),
});

const recommendedNextStepSchema = z.object({
  step: clinicalText(600),
  timeframe: z.enum([
    "immediately",
    "within_24_hours",
    "within_48_hours",
    "within_1_week",
    "routine_follow_up",
  ]),
  category: z.enum([
    "seek_emergency_care",
    "seek_urgent_care",
    "book_clinician",
    "self_care",
    "monitor",
    "information_gathering",
  ]),
  /**
   * Optional on purpose. When a model returns a bare instruction with no
   * justification, there is no honest rationale to write — so none is invented,
   * and the UI omits the paragraph.
   */
  rationale: z.string().trim().max(600).optional(),
});

export const assessmentAiOutputSchema = z.object({
  summary: clinicalText(2_500),
  keyFindings: list(keyFindingSchema, 12),
  symptomAnalysis: list(symptomAnalysisItemSchema, 20),
  documentFindings: list(clinicalText(700), 15),
  imagingObservations: list(clinicalText(700), 12),
  possibleExplanations: list(possibleExplanationSchema, 5)
    .min(1, "at least one possible explanation is required")
    .max(5),
  redFlags: list(redFlagFindingSchema, 15),
  urgency: z.object({
    level: urgencyLevelSchema,
    reason: clinicalText(900),
  }),
  recommendedNextSteps: list(recommendedNextStepSchema, 10),
  questionsForClinician: list(shortText(400), 12),
  limitations: list(shortText(400), 15),
  evidenceUsed: list(shortText(200), 15),
  missingInformation: list(shortText(200), 15),
});
export type AssessmentAiOutputShape = z.infer<typeof assessmentAiOutputSchema>;

/* ------------------------------------------------------------------ *
 * Re-exports
 *
 * The TypeScript domain model derives its AI-output shapes from these schemas so
 * the runtime contract and the compile-time types can never drift apart.
 * ------------------------------------------------------------------ */

export type { MedicalQuestion, QuestionImportance, QuestionOption, QuestionType } from "@/types/ai-primitives";

/** Stage-1 intake output, inferred from its schema. */
export type IntakeAnalysis = IntakeAnalysisOutput;

/** Stage-2 question payload, inferred from its schema. */
export type QuestionsPayload = QuestionsPayloadOutput;

/* ------------------------------------------------------------------ *
 * Shared request schemas (API boundary validation)
 * ------------------------------------------------------------------ */

const trimmedShort = z.string().trim().max(400);

export const intakeRequestSchema = z.object({
  freeText: z.string().trim().max(4_000).default(""),
  age: z.number().int().min(0).max(130).optional(),
  sex: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).optional(),
  duration: z.string().trim().max(200).optional(),
  severity: z.string().trim().max(200).optional(),
  selectedSymptoms: list(trimmedShort, 40).default([]),
  medicalHistory: list(trimmedShort, 30).default([]),
  medications: list(trimmedShort, 40).default([]),
  allergies: list(trimmedShort, 30).default([]),
});

export const questionsRequestSchema = z.object({
  freeText: z.string().trim().max(4_000).default(""),
  age: z.number().int().min(0).max(130).optional(),
  sex: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).optional(),
  symptoms: list(trimmedShort, 40).default([]),
  intake: intakeAnalysisSchema.optional(),
});

export const documentAnalysisRequestSchema = z.object({
  assessmentId: z.string().trim().min(6).max(128),
  uploadId: z.string().trim().min(6).max(128),
  /** Only sent when the server already has the extracted text. */
  extractedText: z.string().max(60_000).optional(),
});

export const imageAnalysisRequestSchema = z.object({
  assessmentId: z.string().trim().min(6).max(128),
  uploadId: z.string().trim().min(6).max(128),
  /** Data URL or https URL. Server re-validates. */
  imageUrl: z.string().min(1).max(12_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const answerValueSchema = z.union([
  z.boolean(),
  z.string().trim().max(2_000),
  z.array(z.string().trim().max(200)).max(12),
  z.number(),
  z.null(),
]);

export const answerInputSchema = z.object({
  questionId: z.string().trim().min(1).max(64),
  question: trimmedShort,
  answer: answerValueSchema,
});

export const caseSnapshotSchema = z.object({
  demographics: z.object({
    age: z.number().int().min(0).max(130).optional(),
    sex: z.enum(["female", "male", "intersex", "prefer_not_to_say", ""]).optional(),
  }),
  symptoms: list(
    z.object({
      name: shortText(160),
      duration: z.string().trim().max(200).optional(),
      severity: z.string().trim().max(200).optional(),
      source: z.enum(["user_selected", "ai_extracted", "ai_suggested"]),
    }),
    40,
  ),
  answers: list(
    z.object({
      question: trimmedShort,
      answer: z.string().trim().max(2_000),
      questionId: z.string().trim().max(64).optional(),
    }),
    60,
  ),
  medicalHistory: list(
    z.object({
      condition: shortText(160),
      status: z.enum(["active", "past", "family", "surgical", ""]),
      note: z.string().trim().max(300).optional(),
    }),
    30,
  ),
  medications: list(trimmedShort, 40),
  allergies: list(trimmedShort, 30),
  lifestyle: z
    .object({
      smoking: z.string().trim().max(120).optional(),
      alcohol: z.string().trim().max(120).optional(),
      pregnancy: z.string().trim().max(120).optional(),
      recentTravel: z.string().trim().max(300).optional(),
      occupationalExposure: z.string().trim().max(300).optional(),
    })
    .default({}),
  documents: list(
    z.object({
      id: z.string().trim().min(1).max(128),
      kind: documentTypeSchema,
      fileName: z.string().trim().max(260),
      mimeType: z.string().trim().max(120),
      sizeBytes: z.number().int().min(0),
      storagePath: z.string().trim().max(400).optional(),
      extractedText: z.string().max(60_000).optional(),
      uploadStatus: z.enum(["pending", "uploaded", "analyzed", "failed"]),
      analysis: documentAnalysisSchema
        .extend({
          extraction: z.object({
            characters: z.number().int().min(0),
            pages: z.number().int().min(0),
            textLayerFound: z.boolean(),
          }),
          truncated: z.boolean(),
        })
        .optional(),
      imaging: z
        .object({
          mode: z.enum(["model_vision", "report_text_only", "unavailable"]),
          analyzedBy: z.string().trim().max(160).optional(),
          observations: list(
            z.object({
              observation: clinicalText(600),
              uncertainty: z.enum(["low", "moderate", "high"]),
              evidence: shortText(500),
              limitations: list(shortText(200), 6),
            }),
            12,
          ),
          limitations: list(shortText(200), 8),
          unavailableReason: z.string().trim().max(400).optional(),
        })
        .optional(),
    }),
    20,
  ),
  freeText: z.string().trim().max(6_000).default(""),
});

export const assessmentRequestSchema = z.object({
  caseData: caseSnapshotSchema,
  /** Reuse an existing intake instead of paying for a second call. */
  intake: intakeAnalysisSchema.optional(),
});

export const presignRequestSchema = z.object({
  assessmentId: z.string().trim().min(6).max(128),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().min(1),
  kind: documentTypeSchema.optional(),
});

export const listAssessmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().trim().max(400).optional(),
  status: z
    .enum(["draft", "in_progress", "analyzing", "complete", "failed"])
    .optional(),
  urgency: urgencyLevelSchema.optional(),
});

export const updateAssessmentSchema = z.object({
  title: z.string().trim().max(160).optional(),
  status: z.enum(["draft", "in_progress", "analyzing", "complete", "failed"]).optional(),
  stage: z.enum(["information", "symptoms", "questions", "documents", "analysis", "assessment"]).optional(),
  caseData: caseSnapshotSchema.partial().optional(),
  answers: list(answerInputSchema, 60).optional(),
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  defaultAge: z.number().int().min(0).max(130).nullable().optional(),
  defaultSex: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).nullable().optional(),
  settings: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      reducedMotion: z.boolean().optional(),
      analyticsOptIn: z.boolean().optional(),
      disclaimerAcknowledgedAt: z.string().datetime().nullable().optional(),
    })
    .optional(),
});

export const shareRequestSchema = z.object({
  enabled: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * Failure-mode guardrails applied after validation
 * ------------------------------------------------------------------ */

/**
 * Phrases that indicate the model has stated a diagnosis with unwarranted
 * certainty. Used to rewrite the offending sentence into hedged language rather
 * than failing the whole response — a small, transparent safety net that runs
 * after Zod and before the data is stored or rendered.
 *
 * Order matters: the "I can confirm that you have X" pattern must run before the
 * bare "you have X" pattern, otherwise it is rewritten into the awkward
 * "I can confirm that the information provided may be consistent with X".
 */
const OVERCONFIDENT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b(?:i|we) (?:can confirm|confirm) (?:that you have|a diagnosis of)\s+([a-z][\w\s-]{2,60})/gi,
    replacement: "this information cannot confirm $1 without clinical evaluation",
  },
  {
    pattern: /\bdiagnosis:\s*([a-z][\w\s-]{2,60})/gi,
    replacement: "possible explanation (not a confirmed diagnosis): $1",
  },
  {
    pattern: /\byou (?:have|are suffering from|are diagnosed with)\s+([a-z][\w\s-]{2,60})/gi,
    replacement: "the information provided may be consistent with $1",
  },
  {
    pattern: /\bthis is (?:definitely|certainly|clearly) ([a-z][\w\s-]{2,60})/gi,
    replacement: "this may be consistent with $1",
  },
];

/** Rewrites over-confident phrasings into hedged language. */
export function hedgeOverconfidentLanguage(input: string): string {
  let out = input;
  for (const { pattern, replacement } of OVERCONFIDENT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Applies hedging across a structured result object, string fields only. */
export function hedgeAssessmentOutput<T>(input: T): T {
  if (typeof input === "string") {
    return hedgeOverconfidentLanguage(input) as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => hedgeAssessmentOutput(item)) as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = typeof value === "string" ? hedgeOverconfidentLanguage(value) : hedgeAssessmentOutput(value);
    }
    return out as T;
  }
  return input;
}