/**
 * POST /api/ai/assessment — Stage 5.
 *
 * Stateless. The browser sends the assembled case; the route runs the
 * deterministic safety layer, makes ONE model call, reconciles the two, and
 * returns the structured result. Nothing is persisted here — the browser writes
 * the validated result to Firestore under the user's own rules.
 *
 * The pipeline order is deliberate:
 *   1. Validate the case snapshot against the Zod schema (no model cost).
 *   2. Run the deterministic red-flag engine (no model cost) to set a FLOOR.
 *   3. One model call to synthesise the narrative.
 *   4. Reconcile: the model may raise urgency, never lower it.
 */

import { availableEvidenceCategories, reconcileUrgency, runAssessment } from "@/lib/ai/stages";
import { assessmentRequestSchema } from "@/lib/ai/schemas";
import { TRIAGE_RULESET_VERSION, evaluateRedFlags } from "@/lib/medical/triage";
import { guardedRoute, jsonError, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";
import type { AssessmentResult } from "@/types/assessment";
import type { MedicalCase } from "@/types/medical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASELINE_LIMITATIONS: string[] = [
  "This assessment was produced by an AI language model from information you supplied. It has not seen you, examined you, or spoken to any clinician.",
  "It cannot order or interpret tests. Anything it says about a laboratory value or an image is a restatement of what your documents already say, not a new interpretation.",
  "It does not prescribe, recommend or dose any medication, and it is not a substitute for professional medical advice.",
  "Symptoms that are serious can be mild, and mild symptoms can turn serious quickly. No automated assessment can replace clinical judgement.",
  "If your symptoms worsen, or if anything here concerns you, contact a healthcare professional. If you think this may be an emergency, contact your local emergency number.",
];

/** Fills in the limit list so it always includes the non-negotiable statements. */
function buildLimitations(modelLimitations: string[]): string[] {
  const merged = [...modelLimitations];
  for (const baseline of BASELINE_LIMITATIONS) {
    if (!merged.some((item) => item.trim() === baseline.trim())) merged.push(baseline);
  }
  return merged;
}

/** Explains which categories had no data, so a thin case reads as thin. */
function deriveMissingInformation(caseData: MedicalCase, modelMissing: string[]): string[] {
  const missing = new Set(modelMissing);

  if (!caseData.freeText.trim()) missing.add("A description of the problem in your own words.");
  if (caseData.demographics.age === undefined) missing.add("Your age.");
  if (!caseData.demographics.sex) missing.add("Sex assigned at birth, where clinically relevant.");
  if (caseData.medications.length === 0) missing.add("Any medication, supplements or doses you take.");
  if (caseData.medicalHistory.length === 0) missing.add("Any ongoing or past medical conditions.");
  if (caseData.allergies.length === 0) missing.add("Any allergies.");
  if (caseData.answers.length === 0) missing.add("Answers to the follow-up questions.");
  if (!caseData.documents.some((d) => d.analysis?.findings.length)) {
    missing.add("Any laboratory results, imaging reports or other documents for this problem.");
  }

  return [...missing].slice(0, 15);
}

export async function POST(request: Request) {
  return guardedRoute({ limit: "assessment" }, async ({ request: req }) => {
    const raw = await readJsonBody<unknown>(req, 512 * 1024);

    const parsed = assessmentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "The case information could not be read. Please go back a step and check your entries.",
        400,
        false,
      );
    }

    const { caseData } = parsed.data;
    const normalizedCase: MedicalCase = { ...caseData, lifestyle: caseData.lifestyle ?? {} };

    // ---- 1. Deterministic floor (free) --------------------------------------
    const triage = evaluateRedFlags(normalizedCase, { includeMonitorRules: true });

    // ---- 2. One model call ---------------------------------------------------
    const availableEvidence = availableEvidenceCategories(normalizedCase);
    const outcome = await runAssessment({
      caseData: normalizedCase,
      availableEvidence,
      deterministicUrgency: triage.level,
      deterministicRedFlags: triage.redFlags.map((f) => `${f.flag}: ${f.why}`),
    });

    // ---- 3. Reconcile urgency ------------------------------------------------
    const merged = reconcileUrgency(outcome.data, {
      level: triage.level,
      redFlags: triage.redFlags,
    });

    const result: AssessmentResult = {
      summary: outcome.data.summary,
      keyFindings: outcome.data.keyFindings,
      symptomAnalysis: outcome.data.symptomAnalysis,
      documentFindings: outcome.data.documentFindings,
      imagingObservations: outcome.data.imagingObservations,
      possibleExplanations: outcome.data.possibleExplanations.map((explanation, index) => ({
        ...explanation,
        rank: explanation.rank ?? index + 1,
      })),
      redFlags: merged.redFlags,
      urgency: merged.urgency,
      recommendedNextSteps: outcome.data.recommendedNextSteps,
      questionsForClinician: outcome.data.questionsForClinician,
      limitations: buildLimitations(outcome.data.limitations),
      evidenceUsed:
        outcome.data.evidenceUsed.length > 0 ? outcome.data.evidenceUsed : availableEvidence,
      missingInformation: deriveMissingInformation(normalizedCase, outcome.data.missingInformation),
    };

    return jsonOk(
      {
        result,
        triage,
        audit: outcome.audit,
        rulesetVersion: TRIAGE_RULESET_VERSION,
      },
      200,
      API_HEADERS,
    );
  })(request);
}