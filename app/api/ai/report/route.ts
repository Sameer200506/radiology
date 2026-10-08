/**
 * POST /api/ai/report — Stage 6.
 *
 * Stateless. The report is rendered DETERMINISTICALLY from the validated
 * assessment the browser already holds: it performs no model call for the
 * document itself, so print, PDF and screen cannot disagree.
 *
 * The optional practitioner brief does make one model call, and only when the
 * user explicitly asks for it.
 */

import { describeModel, PROMPT_VERSION } from "@/lib/ai/models";
import { completeValidated } from "@/lib/ai/openrouter";
import { z } from "zod";

import {
  buildPractitionerBriefPrompt,
  buildReportDocument,
  type ReportInput,
} from "@/lib/ai/prompts/report";
import { TRIAGE_RULESET_VERSION } from "@/lib/medical/triage";
import { guardedRoute, jsonError, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";
import { assessmentAiOutputSchema } from "@/lib/ai/schemas";
import { guardedCaseSchema, type GuardedCase } from "@/lib/api/guarded-case";
import type { AssessmentResult, TriageResult } from "@/types/assessment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const practitionerBriefSchema = z.object({
  headline: z.string().trim().min(1).max(300),
  chronology: z.string().trim().min(1).max(800),
  keyPoints: z.array(z.string().trim().min(1).max(400)).max(6),
  openQuestions: z.array(z.string().trim().min(1).max(400)).max(5),
});

/**
 * The triage result is regenerated server-side from the case snapshot rather
 * than trusted from the browser. That means a tampered client cannot talk the
 * report into claiming a lower urgency than the rules produce.
 */
const requestSchema = z.object({
  title: z.string().trim().max(160).optional(),
  isDemo: z.boolean().optional(),
  result: assessmentAiOutputSchema.optional(),
  triage: z.unknown().optional(),
  caseData: guardedCaseSchema,
  audit: z
    .object({
      model: z.string().max(200).optional(),
      promptVersion: z.string().max(60).optional(),
      usedFallback: z.boolean().optional(),
      repairAttempted: z.boolean().optional(),
    })
    .optional(),
  withBrief: z.boolean().optional(),
});

export async function POST(request: Request) {
  return guardedRoute({ limit: "report" }, async ({ request: req }) => {
    const raw = await readJsonBody<unknown>(req, 512 * 1024);

    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "The assessment data could not be read, so no report was generated.",
        400,
        false,
      );
    }

    const body = parsed.data;
    const caseData: GuardedCase = body.caseData;

    // Without an analysis there is nothing to report on.
    if (!body.result) {
      return jsonError(
        "VALIDATION_ERROR",
        "Run the analysis before generating a report.",
        400,
        false,
      );
    }

    const { evaluateRedFlags } = await import("@/lib/medical/triage");
    const recomputed = evaluateRedFlags(caseData);

    // Prefer the values the analysis stage actually used when they were sent;
    // otherwise fall back to what the rules produce right now.
    const clientTriage = body.triage as Partial<TriageResult> | undefined;
    const triage: TriageResult = {
      level: recomputed.level,
      escalated: recomputed.escalated,
      redFlags: recomputed.redFlags.length > 0 ? recomputed.redFlags : (clientTriage?.redFlags ?? []),
      emergencyNotice: recomputed.emergencyNotice,
      firedRules: recomputed.firedRules,
      notes: recomputed.notes,
    };

    const modelId = body.audit?.model ?? "unknown";

    const reportInput: ReportInput = {
      assessmentId: "current",
      reportTitle: body.title?.trim() || "MedAssist AI — Health Information Assessment",
      createdAt: new Date().toISOString(),
      patientLabel: body.isDemo ? "DEMO PATIENT (synthetic data)" : "Private user account",
      result: body.result as unknown as AssessmentResult,
      triage,
      // The factual sections restate what the user entered.
      caseData,
      evidenceSummary: body.result.evidenceUsed ?? [],
      missingSummary: body.result.missingInformation ?? [],
      modelLabel: `${modelId} (${describeModel(modelId).label})`,
      rulesetVersion: body.audit?.promptVersion ?? TRIAGE_RULESET_VERSION,
    };

    const document = buildReportDocument(reportInput);

    let brief: z.infer<typeof practitionerBriefSchema> | null = null;
    let briefError: string | null = null;

    if (body.withBrief === true) {
      try {
        const { data } = await completeValidated(practitionerBriefSchema, {
          system:
            "You write short patient-communication briefs. You never diagnose and you never prescribe. Return only JSON.",
          user: buildPractitionerBriefPrompt(reportInput, "brief"),
          temperature: 0.3,
          maxTokens: 1_024,
          repairHint:
            "Required keys: headline (string), chronology (string), keyPoints (string[]), openQuestions (string[]).",
        });
        brief = data;
      } catch (error) {
        // The report is still valid without the brief.
        briefError =
          error instanceof Error && "message" in error
            ? String((error as { message: string }).message)
            : "The brief could not be generated.";
      }
    }

    return jsonOk(
      {
        report: document,
        ...(brief ? { brief } : {}),
        ...(briefError ? { briefError } : {}),
        triage,
        promptVersion: PROMPT_VERSION,
      },
      200,
      API_HEADERS,
    );
  })(request);
}