/**
 * AI stage orchestrators.
 *
 * Each function here owns one pipeline stage: it prepares untrusted input,
 * calls the centralised client, validates the response, and returns a typed
 * result plus audit metadata. Route handlers stay thin and contain no prompt
 * text.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import type { MedicalCase, MedicalDocument } from "@/types/medical";
import type { AuditMetadata } from "@/types/assessment";

import {
  assessmentAiOutputSchema,
  documentAnalysisSchema,
  hedgeAssessmentOutput,
  imagingAnalysisSchema,
  intakeAnalysisSchema,
  questionsPayloadSchema,
  type AssessmentAiOutputShape,
  type DocumentAnalysisOutput,
  type ImagingAnalysisOutput,
  type IntakeAnalysisOutput,
  type QuestionsPayloadOutput,
} from "@/lib/ai/schemas";
import { completeValidated, AiError } from "@/lib/ai/openrouter";
import { coerceAiPayload } from "@/lib/ai/coerce";
import { PROMPT_VERSION, maxTokensForStage, visionModel } from "@/lib/ai/models";

import {
  assessmentSystemPrompt,
  buildAssessmentPrompt,
  type AssessmentPromptInput,
} from "@/lib/ai/prompts/assessment";
import {
  buildDocumentPrompt,
  documentSystemPrompt,
  type DocumentPromptInput,
} from "@/lib/ai/prompts/document";
import {
  buildImagingPrompt,
  imagingSystemPrompt,
} from "@/lib/ai/prompts/imaging";
import {
  buildIntakePrompt,
  INTAKE_PROMPT_VERSION,
  intakeSystemPrompt,
  type IntakeInput,
} from "@/lib/ai/prompts/intake";
import {
  buildQuestionsPrompt,
  QUESTIONS_PROMPT_VERSION,
  questionsSystemPrompt,
  type QuestionsInput,
} from "@/lib/ai/prompts/questions";

function seed(): string {
  return randomUUID();
}

function meta(
  stage: string,
  promptVersion: string,
  result: { model: string; provider: string; latencyMs: number; usedFallback: boolean; usage: { promptTokens?: number; completionTokens?: number } },
  inputCategories: string[],
  repaired: boolean,
): AuditMetadata {
  const completedAt = new Date().toISOString();
  return {
    model: result.model,
    modelProvider: result.provider,
    promptVersion,
    stage,
    startedAt: completedAt,
    completedAt,
    inputCategories,
    latencyMs: result.latencyMs,
    tokensIn: result.usage.promptTokens,
    tokensOut: result.usage.completionTokens,
    usedFallback: result.usedFallback,
    repairAttempted: repaired,
  };
}

export interface StageOutcome<T> {
  data: T;
  audit: AuditMetadata;
}

/* ------------------------------------------------------------------ *
 * Stage 1 — Intake
 * ------------------------------------------------------------------ */

export async function runIntake(input: IntakeInput): Promise<StageOutcome<IntakeAnalysisOutput>> {
  const requestSeed = seed();
  const { data, completion, repaired } = await completeValidated(intakeAnalysisSchema, {
    system: intakeSystemPrompt(),
    user: buildIntakePrompt(input, requestSeed),
    maxTokens: maxTokensForStage("intake"),
    coerce: coerceAiPayload,
    repairHint:
      'Required keys: symptoms (string[]), duration (string), severity (string), associatedSymptoms (string[]), riskFactors (string[]), missingInformation (string[]), redFlags (string[]).',
  });

  return {
    data,
    audit: meta(
      "intake",
      INTAKE_PROMPT_VERSION,
      completion,
      ["freeText", "selectedSymptoms", "demographics"],
      repaired,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Stage 2 — Dynamic questions
 * ------------------------------------------------------------------ */

export async function runQuestions(
  input: QuestionsInput,
): Promise<StageOutcome<QuestionsPayloadOutput>> {
  const requestSeed = seed();
  const { data, completion, repaired } = await completeValidated(questionsPayloadSchema, {
    system: questionsSystemPrompt(),
    user: buildQuestionsPrompt(input, requestSeed),
    maxTokens: maxTokensForStage("questions"),
    coerce: coerceAiPayload,
    repairHint:
      'Required keys: questions (array of 3-8 objects with id, question, type, importance; options required for single_choice/multiple_choice), rationale (string).',
  });

  return {
    data,
    audit: meta(
      "questions",
      QUESTIONS_PROMPT_VERSION,
      completion,
      input.intake ? ["freeText", "symptoms", "intake"] : ["freeText", "symptoms"],
      repaired,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Stage 3 — Document analysis
 * ------------------------------------------------------------------ */

export interface DocumentStageInput extends DocumentPromptInput {
  /** Empty when the document has no readable text layer. */
  readable: boolean;
}

export async function runDocumentAnalysis(
  input: DocumentStageInput,
): Promise<StageOutcome<DocumentAnalysisOutput>> {
  const requestSeed = seed();

  // No text layer: do not spend a model call describing nothing.
  if (!input.readable || input.extractedText.trim().length === 0) {
    return {
      data: {
        documentType: "unknown",
        findings: [],
        reportRecommendations: [],
        warnings: [
          "No readable text could be extracted from this file. It is most likely a scanned document or an image of a report. A written report summary would need to be typed in manually, or the document replaced with a text-based PDF.",
        ],
      },
      audit: meta(
        "document",
        PROMPT_VERSION,
        {
          model: "skipped",
          provider: "none",
          latencyMs: 0,
          usedFallback: false,
          usage: {},
        },
        ["extraction"],
        false,
      ),
    };
  }

  const { data, completion, repaired } = await completeValidated(documentAnalysisSchema, {
    system: documentSystemPrompt(),
    user: buildDocumentPrompt(input, requestSeed),
    temperature: 0,
    maxTokens: maxTokensForStage("document"),
    coerce: coerceAiPayload,
    repairHint:
      'Required keys: documentType (enum), findings (array of {test, value, unit, referenceRange, status, evidence, note}), impression (optional), reportRecommendations (string[]), warnings (string[]). Values must be copied verbatim from the document.',
  });

  // Guard against a hallucinated finding: every value must be traceable.
  const grounded = data.findings.filter((f) => !f.value || input.extractedText.includes(f.value));

  return {
    data: {
      ...data,
      findings: grounded,
      warnings: [
        ...data.warnings,
        ...(grounded.length !== data.findings.length
          ? [
              `${data.findings.length - grounded.length} candidate finding(s) were discarded because their values could not be located in the source text.`,
            ]
          : []),
      ],
    },
    audit: meta("document", PROMPT_VERSION, completion, ["extractedText"], repaired),
  };
}

/* ------------------------------------------------------------------ *
 * Stage 4 — Imaging
 * ------------------------------------------------------------------ */

export interface ImagingStageInput {
  fileName: string;
  mimeType: string;
  base64: string;
  contextNote?: string;
}

export type ImagingStageResult =
  | { mode: "model_vision"; analysis: ImagingAnalysisOutput; audit: AuditMetadata }
  | { mode: "unavailable"; reason: string; audit: AuditMetadata };

export async function runImagingAnalysis(
  input: ImagingStageInput,
): Promise<ImagingStageResult> {
  const model = visionModel();

  if (!model) {
    return {
      mode: "unavailable",
      reason:
        "Image analysis is not available with the currently configured model. A written radiology report can still be analyzed.",
      audit: meta(
        "imaging",
        PROMPT_VERSION,
        {
          model: "skipped",
          provider: "none",
          latencyMs: 0,
          usedFallback: false,
          usage: {},
        },
        ["image"],
        false,
      ),
    };
  }

  const requestSeed = seed();
  const { data, completion, repaired } = await completeValidated(imagingAnalysisSchema, {
    system: imagingSystemPrompt(),
    user: buildImagingPrompt(
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        imageBase64: input.base64,
        ...(input.contextNote ? { contextNote: input.contextNote } : {}),
      },
      requestSeed,
    ),
    images: [{ base64: input.base64, mimeType: input.mimeType }],
    modelOverride: model,
    temperature: 0.2,
    maxTokens: maxTokensForStage("imaging"),
    coerce: coerceAiPayload,
    repairHint:
      "Required key: observations — an array of {observation (string), uncertainty ('low'|'moderate'|'high'), evidence (string), limitations (string[])}.",
  });

  return {
    mode: "model_vision",
    analysis: data,
    audit: meta("imaging", PROMPT_VERSION, completion, ["image"], repaired),
  };
}

/* ------------------------------------------------------------------ *
 * Stage 5 — Final assessment
 * ------------------------------------------------------------------ */

export async function runAssessment(
  input: AssessmentPromptInput,
): Promise<StageOutcome<AssessmentAiOutputShape>> {
  const requestSeed = seed();
  const { data, completion, repaired } = await completeValidated(assessmentAiOutputSchema, {
    system: assessmentSystemPrompt(),
    user: buildAssessmentPrompt(input, requestSeed),
    maxTokens: maxTokensForStage("assessment"),
    coerce: coerceAiPayload,
    repairHint:
      "Required keys: summary (string), keyFindings, symptomAnalysis, documentFindings (string[]), imagingObservations (string[]), possibleExplanations (array of 1-5 objects with rank, explanation, whyItMayFit, whatWouldTestIt, confidenceNote), redFlags, urgency {level, reason}, recommendedNextSteps, questionsForClinician, limitations, evidenceUsed, missingInformation.",
  });

  const available = input.availableEvidence;

  return {
    // Hedging runs after validation so it cannot break the schema contract.
    data: hedgeAssessmentOutput(data),
    audit: meta("assessment", PROMPT_VERSION, completion, available, repaired),
  };
}

/**
 * Urgency reconciliation.
 *
 * Implemented in lib/medical/reconcile-urgency.ts so the safety-critical merge
 * is testable without importing a server-only module. Re-exported here because
 * this is the module route handlers already import.
 */
export { coerceLevel, reconcileUrgency } from "@/lib/medical/reconcile-urgency";


/** Convenience re-export so route handlers import from one place. */
export { AiError };

/** Documents that carry analysis, for the evidence summary in the prompt. */
export function documentsWithAnalysis(documents: MedicalDocument[]): MedicalDocument[] {
  return documents.filter((d) => Boolean(d.analysis) || Boolean(d.imaging));
}

/** Human-readable list of evidence categories actually present in a case. */
export function availableEvidenceCategories(caseData: MedicalCase): string[] {
  const categories: string[] = [];
  if (caseData.freeText.trim().length > 0) categories.push("patient description");
  if (caseData.symptoms.length > 0) categories.push("reported symptoms");
  if (caseData.answers.length > 0) categories.push("follow-up answers");
  if (caseData.demographics.age !== undefined || caseData.demographics.sex) {
    categories.push("demographics");
  }
  if (caseData.medicalHistory.length > 0) categories.push("medical history");
  if (caseData.medications.length > 0) categories.push("medications");
  if (caseData.allergies.length > 0) categories.push("allergies");
  if (documentsWithAnalysis(caseData.documents).length > 0) {
    categories.push("uploaded documents with transcribed findings");
  }
  const visionDocs = caseData.documents.filter((d) => d.imaging?.mode === "model_vision");
  if (visionDocs.length > 0) categories.push("visual observations from uploaded images");
  return categories.length > 0 ? categories : ["symptoms only; no documents, history or demographics were provided"];
}
