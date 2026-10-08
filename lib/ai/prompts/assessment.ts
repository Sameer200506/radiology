import type { MedicalCase } from "@/types/medical";
import { fence, makeNonce, prepareForPrompt } from "@/lib/security/untrusted";
import {
  ANTI_INJECTION,
  DISCLAIMER_LINE,
  SAFETY_RULES,
  SYSTEM_ROLE,
  jsonOnlyInstruction,
} from "@/lib/ai/prompts/safety";

export const ASSESSMENT_PROMPT_VERSION = "assessment-v1";

export interface AssessmentPromptInput {
  caseData: MedicalCase;
  /** Which input categories actually carried content. */
  availableEvidence: string[];
  /** Determined upstream by a separate deterministic layer. */
  deterministicUrgency: string;
  deterministicRedFlags: string[];
}

function bullet(values: string[], empty = "- (none provided)"): string {
  if (!values || values.length === 0) return empty;
  return values.map((v) => `- ${v}`).join("\n");
}

function formatAnswers(caseData: MedicalCase): string {
  if (caseData.answers.length === 0) return "- (no follow-up answers recorded)";
  return caseData.answers
    .map((a) => `- Q: ${a.question}\n  A: ${a.answer}`)
    .join("\n");
}

function formatDocuments(caseData: MedicalCase): string {
  if (caseData.documents.length === 0) return "- (no documents uploaded)";
  return caseData.documents
    .map((doc) => {
      const lines: string[] = [`- ${doc.fileName} [${doc.kind}]`];
      const analysis = doc.analysis;
      if (analysis) {
        lines.push(`  document type as classified: ${analysis.documentType}`);
        if (analysis.findings.length > 0) {
          lines.push("  transcribed values (already extracted from the document, not invented):");
          for (const f of analysis.findings) {
            const range = f.referenceRange ? ` [ref ${f.referenceRange}]` : "";
            const unit = f.unit ? ` ${f.unit}` : "";
            lines.push(`    - ${f.test}: ${f.value ?? "(value not stated)"}${unit}${range} — status: ${f.status}`);
          }
        } else {
          lines.push("  no transcribed values (the document had no readable text layer)");
        }
        if (analysis.impression) lines.push(`  the document's own impression: ${analysis.impression}`);
        if (analysis.reportRecommendations.length > 0) {
          lines.push("  recommendations the document itself made:");
          for (const r of analysis.reportRecommendations) lines.push(`    - ${r}`);
        }
        for (const w of analysis.warnings) lines.push(`  extraction warning: ${w}`);
      }
      const imaging = doc.imaging;
      if (imaging) {
        lines.push(`  imaging mode: ${imaging.mode}`);
        if (imaging.mode === "model_vision") {
          lines.push("  observations a language model reported from the image (NOT a diagnosis):");
          for (const o of imaging.observations) {
            lines.push(`    - ${o.observation} (uncertainty: ${o.uncertainty}; basis: ${o.evidence})`);
          }
        } else if (imaging.unavailableReason) {
          lines.push(`  image was not analysed: ${imaging.unavailableReason}`);
        }
      }
      return lines.join("\n");
    })
    .join("\n");
}

export function buildAssessmentPrompt(input: AssessmentPromptInput, seed: string): string {
  const nonce = makeNonce(seed);
  const { caseData } = input;
  const freeText = prepareForPrompt(caseData.freeText, { maxChars: 5_000 });

  const demographics = [
    caseData.demographics.age === undefined ? "age: not stated" : `age: ${caseData.demographics.age}`,
    caseData.demographics.sex ? `sex: ${caseData.demographics.sex}` : "sex: not stated",
  ].join(", ");

  const lifestyleEntries = Object.entries(caseData.lifestyle).filter(([, v]) => Boolean(v?.trim()));
  const lifestyle = lifestyleEntries.length === 0 ? "- (not provided)" : lifestyleEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n");

  const body = `## Task

Produce a structured, cautious health-information summary from the case below, so the person
can have a better conversation with a healthcare professional.

You are organising and explaining. You are NOT diagnosing.

## Urgency — important

A separate, deterministic, non-AI safety layer has already evaluated this case and produced
its own urgency level: **${input.deterministicUrgency}**.

- If that level is EMERGENCY or URGENT, your urgency output MUST be at least that level.
  Never report something less time-critical than the deterministic layer found.
- You may report a HIGHER level than the deterministic layer if the combination of evidence
  genuinely warrants it, and you must then say in "reason" exactly which findings drove it.
- If the deterministic layer identified red flags, they are already handled by the application.
  Include them in "redFlags" with source "deterministic_rule" only if you can see the same
  evidence in the case data. Never contradict the deterministic layer.
- If there are no red flags, return an empty "redFlags" array. Do not manufacture concern, and
  do not manufacture reassurance.

## Structure

- "summary": two to four sentences. What the person reported, what the documents show, and what
  remains unknown. Hedge throughout.
- "keyFindings": at most 12, each with a "source" field so the user can see where it came from.
  Do not restate the same finding twice.
- "symptomAnalysis": one entry per distinct symptom. Interpret it, do not merely repeat it.
- "documentFindings": what the uploaded documents show, as prose. Attribute every claim to a
  document. If no document contained a readable text layer, say exactly that and do not describe
  findings you do not have.
- "imagingObservations": strictly a separate list. Only include observations a language model
  reported as visible in an image, and always attribute them as unverified visual observations
  that need a clinician. If no image was analysed, return an empty array.
- "possibleExplanations": 2 to 5 ranked candidate explanations. For each one, state "whyItMayFit"
  using only evidence actually present in this case, and "whatWouldTestIt" as what a clinician
  would do to confirm or exclude it. Never name more than 5. Never present any of them as the
  answer. If the evidence supports only one plausible reading, give that one plus a clear
  statement that more information is needed.
- "recommendedNextSteps": what to DO, not what to take. Never name a medication, a dose, or a
  treatment. Appropriate steps are: contact emergency services, attend urgent care, book a
  clinician appointment, monitor and record symptoms, gather information, and general
  self-care measures that are safe for everyone (rest, fluids, avoiding known triggers).
  Attach a timeframe to each.
- "questionsForClinician": questions the person can ask a professional to make the appointment
  more useful.
- "limitations": what this assessment cannot tell you. Always include the fundamental ones.
- "evidenceUsed": which categories of information actually shaped your output.
- "missingInformation": what you still need. Be specific.

## Language rules

Use: "may be consistent with", "could indicate", "one possible explanation is",
"cannot be confirmed from this information alone", "would need clinical evaluation",
"a qualified healthcare professional should review".

Never use: "you have", "diagnosis:", "this is definitely", "I confirm", "you are suffering from".

Never give a numeric probability or confidence percentage for any condition.

## Output schema

{
  "summary": string,
  "keyFindings": [{ "title": string, "detail": string, "source": "symptoms | answers | document | imaging | demographics | history" }],
  "symptomAnalysis": [{ "symptom": string, "interpretation": string, "severityNote": string, "durationNote": string }],
  "documentFindings": string[],
  "imagingObservations": string[],
  "possibleExplanations": [
    {
      "rank": 1,
      "explanation": string,
      "whyItMayFit": string[],
      "whatWouldTestIt": string[],
      "confidenceNote": string
    }
  ],
  "redFlags": [{ "flag": string, "why": string, "source": "deterministic_rule | ai_identified | user_stated", "severity": "escalate | urgent_review | monitor" }],
  "urgency": { "level": "ROUTINE | NON_URGENT | PROMPT_MEDICAL_REVIEW | URGENT | EMERGENCY", "reason": string },
  "recommendedNextSteps": [
    {
      "step": string,
      "timeframe": "immediately | within_24_hours | within_48_hours | within_1_week | routine_follow_up",
      "category": "seek_emergency_care | seek_urgent_care | book_clinician | self_care | monitor | information_gathering",
      "rationale": string
    }
  ],
  "questionsForClinician": string[],
  "limitations": string[],
  "evidenceUsed": string[],
  "missingInformation": string[]
}

At most 5 possibleExplanations. At most 8 recommendedNextSteps.

${jsonOnlyInstruction("summary, keyFindings, symptomAnalysis, documentFindings, imagingObservations, possibleExplanations, redFlags, urgency, recommendedNextSteps, questionsForClinician, limitations, evidenceUsed, missingInformation")}`;

  const caseBlock = `<UNTRUSTED_MEDICAL_DOCUMENT nonce="${nonce}">
demographics: ${demographics}

symptoms reported:
${bullet(caseData.symptoms.map((s) => `${s.name}${s.duration ? ` (duration: ${s.duration})` : ""}${s.severity ? ` (severity: ${s.severity})` : ""}`), "- (none reported)")}

follow-up answers:
${formatAnswers(caseData)}

medical history:
${bullet(caseData.medicalHistory.map((h) => `${h.condition}${h.status ? ` (${h.status})` : ""}`))}

medications:
${bullet(caseData.medications)}

allergies:
${bullet(caseData.allergies)}

lifestyle and context:
${lifestyle}

the person's own description:
${fence(freeText.text, "untrusted_user", nonce)}

uploaded documents and what was transcribed from them:
${formatDocuments(caseData)}

information categories actually available for this case: ${input.availableEvidence.join(", ")}
</UNTRUSTED_MEDICAL_DOCUMENT nonce="${nonce}">`;

  const redFlagBlock =
    input.deterministicRedFlags.length > 0
      ? `Findings already flagged by the deterministic safety layer (treat as established, not as your own conclusion):\n${bullet(input.deterministicRedFlags)}`
      : "The deterministic safety layer did not flag any red flag in this case. Do not treat that as reassurance.";

  return [
    SYSTEM_ROLE,
    SAFETY_RULES,
    ANTI_INJECTION,
    "You synthesise a cautious health-information summary. You never diagnose and you never advise on medication. Return only JSON.",
    body,
    redFlagBlock,
    caseBlock,
    DISCLAIMER_LINE,
  ].join("\n\n");
}

export function assessmentSystemPrompt(): string {
  return `${SYSTEM_ROLE}

${SAFETY_RULES}

${ANTI_INJECTION}

You produce a structured, hedged health-information summary from user-supplied data. You never
state a diagnosis, never prescribe, and never claim certainty. Return only JSON.`;
}