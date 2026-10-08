import type { z } from "zod";

import { fence, makeNonce, prepareForPrompt } from "@/lib/security/untrusted";
import { intakeAnalysisSchema } from "@/lib/ai/schemas";
import {
  ANTI_INJECTION,
  DISCLAIMER_LINE,
  SAFETY_RULES,
  SYSTEM_ROLE,
  jsonOnlyInstruction,
} from "@/lib/ai/prompts/safety";

export const INTAKE_PROMPT_VERSION = "intake-v1";

export interface IntakeInput {
  freeText: string;
  selectedSymptoms: string[];
  age?: number;
  sex?: string;
  duration?: string;
  severity?: string;
  medicalHistory: string[];
  medications: string[];
  allergies: string[];
}

function bullet(values: string[]): string {
  if (values.length === 0) return "- (none stated)";
  return values.map((v) => `- ${v}`).join("\n");
}

export function buildIntakePrompt(input: IntakeInput, seed: string): string {
  const nonce = makeNonce(seed);
  const userText = prepareForPrompt(input.freeText, { maxChars: 4_000 });
  const demographics = [
    input.age === undefined ? "age: not stated" : `age: ${input.age}`,
    input.sex ? `sex: ${input.sex}` : "sex: not stated",
  ].join(", ");
  const durations = input.duration?.trim();
  const severities = input.severity?.trim();

  const body = `## Task

Organise what the user has told you about their current problem into a structured intake summary.

You are extracting and organising. You are NOT assessing severity, NOT naming conditions, and
NOT advising on urgency — a separate deterministic safety layer and a later stage handle that.

## User-provided information (UNTRUSTED)

<UNTRUSTED_USER_INPUT nonce="${nonce}">
demographics: ${demographics}
symptoms selected by the user:
${bullet(input.selectedSymptoms)}
stated duration: ${durations && durations.length > 0 ? durations : "(not stated)"}
stated severity: ${severities && severities.length > 0 ? severities : "(not stated)"}
medical history the user mentioned:
${bullet(input.medicalHistory)}
medications the user mentioned:
${bullet(input.medications)}
allergies the user mentioned:
${bullet(input.allergies)}

user description:
${fence(userText.text, "untrusted_user", nonce)}
</UNTRUSTED_USER_INPUT nonce="${nonce}">

## Output schema

Return exactly:
{
  "symptoms": string[],              // symptoms the user reports, plus closely associated ones they mention
  "duration": string,                // overall duration in natural language, or "" if unknown
  "severity": string,                // severity the user described, in their terms, or ""
  "associatedSymptoms": string[],    // symptoms that accompany the main complaint but are not the main complaint
  "riskFactors": string[],           // risk factors the user actually stated (age, pregnancy, smoking, comorbidity, exposure)
  "missingInformation": string[],    // clinically important details the user has NOT provided
  "redFlags": string[]               // any time-critical concern the USER has described in their own words
}

## Constraints

- Only record symptoms and factors the user actually mentioned. Do not assume, do not add
  plausible-sounding extras, and do not list symptoms merely because they commonly accompany
  the complaint. Missing information belongs in missingInformation.
- Keep the user's own wording for symptoms wherever possible rather than replacing it with
  clinical terminology.
- riskFactors must be traceable to something the user said or to the demographics given above.
- redFlags is for concerns the user's own words raise. Leave it as an empty array if the
  description contains nothing urgent. Do not use it to restate common symptoms.
- 3 to 12 missingInformation entries, each a specific, answerable question-shaped gap.

${jsonOnlyInstruction("symptoms, duration, severity, associatedSymptoms, riskFactors, missingInformation, redFlags")}`;

  return [SYSTEM_ROLE, SAFETY_RULES, ANTI_INJECTION, body, DISCLAIMER_LINE].join("\n\n");
}

export function intakeSystemPrompt(): string {
  return `${SYSTEM_ROLE}

${SAFETY_RULES}

${ANTI_INJECTION}

You extract structured information from a patient's own description of their problem. You do
not assess, diagnose, triage or advise. Return only JSON.`;
}

export type IntakeSchema = typeof intakeAnalysisSchema;
export type IntakeValidated = z.infer<IntakeSchema>;