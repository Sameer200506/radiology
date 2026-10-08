import { fence, makeNonce, prepareForPrompt } from "@/lib/security/untrusted";
import { questionsPayloadSchema, type IntakeAnalysisOutput } from "@/lib/ai/schemas";
import {
  ANTI_INJECTION,
  DISCLAIMER_LINE,
  SAFETY_RULES,
  SYSTEM_ROLE,
  jsonOnlyInstruction,
} from "@/lib/ai/prompts/safety";

export const QUESTIONS_PROMPT_VERSION = "questions-v1";

export interface QuestionsInput {
  freeText: string;
  symptoms: string[];
  age?: number;
  sex?: string;
  intake?: IntakeAnalysisOutput;
}

function bullet(values: string[], empty = "- (none stated)"): string {
  if (!values || values.length === 0) return empty;
  return values.map((v) => `- ${v}`).join("\n");
}

export function buildQuestionsPrompt(input: QuestionsInput, seed: string): string {
  const nonce = makeNonce(seed);
  const userText = prepareForPrompt(input.freeText, { maxChars: 4_000 });
  const demographics = [
    input.age === undefined ? "age: not stated" : `age: ${input.age}`,
    input.sex ? `sex: ${input.sex}` : "sex: not stated",
  ].join(", ");

  const intakeBlock = input.intake
    ? `structured intake from an earlier stage of this same application:
${bullet(input.intake.symptoms, "- (none)")}
overall duration: ${input.intake.duration || "(not stated)"}
severity in the user's words: ${input.intake.severity || "(not stated)"}
associated symptoms: ${bullet(input.intake.associatedSymptoms, "- (none)")}
already-known risk factors: ${bullet(input.intake.riskFactors, "- (none)")}
information already known to be missing: ${bullet(input.intake.missingInformation, "- (none)")}`
    : "No structured intake is available; work from the user's description only.";

  const body = `## Task

Choose a small set of follow-up questions whose answers would genuinely change how this
presentation is understood.

## How many questions

Between 3 and 8. Fewer is better. If 4 well-chosen questions are enough, give 4. Do not pad
the list to reach a target.

## How to choose

Ask a question only when a plausible, safe answer would change the interpretation. Good
questions isolate a discriminator: something whose presence points one way and whose absence
points another. Prioritise in this order:

1. Questions that could reveal a time-critical concern and must be asked before anything else.
2. Questions that separate materially different explanations (for example dry versus productive
   cough, or central versus referred pain).
3. Questions that establish the time course, because duration re-frames almost everything.
4. Questions that capture severity objectively rather than by impression (a measured
   temperature, a SpO2 reading, a pain score out of ten).
5. Questions about exposure, recent events or context that would change the shortlist.

Never ask for information already supplied in the intake. Never ask for name, address,
contact details, or any identifier. Never ask the same thing in two different words.

## Question types

Use exactly one of: "yes_no", "single_choice", "multiple_choice", "number", "temperature",
"text", "duration".

- yes_no — a genuine either/or.
- single_choice — mutually exclusive options; supply at least 2 options.
- multiple_choice — may apply more than once; supply at least 2 options.
- number — a plain quantity (for example "how many episodes today?").
- temperature — a measured body temperature; set "unit" to "°C or °F".
- text — a short free-text answer. Set "placeholder" to show the expected shape.
- duration — a length of time; set "placeholder" to show the expected shape.

Options must be realistic answers a person would actually give. Keep option values
machine-friendly: "yes", "no", "less_than_3_days", "under_2_weeks".

## Importance

"high" — the answer could change urgency or eliminate half the shortlist.
"medium" — the answer narrows the shortlist.
"low" — useful context only. Use sparingly.

## Output schema

{
  "questions": [
    {
      "id": "snake_case_identifier",
      "question": "the question, phrased for a person who is unwell",
      "type": "yes_no | single_choice | multiple_choice | number | temperature | text | duration",
      "importance": "high | medium | low",
      "rationale": "one short sentence on why this matters",
      "options": [{ "value": "machine_key", "label": "shown to the user" }],
      "unit": "optional unit hint for numeric types",
      "placeholder": "optional placeholder for text and duration types"
    }
  ],
  "rationale": "one or two sentences explaining what the set of questions is trying to establish"
}

"options" is required for single_choice and multiple_choice and must be omitted for every
other type. Order questions most important first.

${jsonOnlyInstruction("questions, rationale")}`;

  const inputBlock = `<UNTRUSTED_USER_INPUT nonce="${nonce}">
demographics: ${demographics}

user description:
${fence(userText.text, "untrusted_user", nonce)}

${intakeBlock}
</UNTRUSTED_USER_INPUT nonce="${nonce}">`;

  return [SYSTEM_ROLE, SAFETY_RULES, ANTI_INJECTION, body, inputBlock, DISCLAIMER_LINE].join("\n\n");
}

export function questionsSystemPrompt(): string {
  return `${SYSTEM_ROLE}

${SAFETY_RULES}

${ANTI_INJECTION}

You design short sets of follow-up questions for a self-service intake form. You do not assess
the patient and you do not answer the questions yourself. Return only JSON.`;
}

export type QuestionsSchema = typeof questionsPayloadSchema;