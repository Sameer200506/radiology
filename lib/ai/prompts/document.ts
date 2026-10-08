import { fence, makeNonce, prepareForPrompt } from "@/lib/security/untrusted";
import {
  ANTI_INJECTION,
  DISCLAIMER_LINE,
  SAFETY_RULES,
  SYSTEM_ROLE,
  jsonOnlyInstruction,
} from "@/lib/ai/prompts/safety";

export const DOCUMENT_PROMPT_VERSION = "document-v1";

export interface DocumentPromptInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Text already extracted by the server. */
  extractedText: string;
  /** How the extraction went, so the model knows what it is or is not seeing. */
  extraction: {
    characters: number;
    pages: number;
    textLayerFound: boolean;
    truncated: boolean;
  };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildDocumentPrompt(input: DocumentPromptInput, seed: string): string {
  const nonce = makeNonce(seed);
  const text = prepareForPrompt(input.extractedText, { maxChars: 24_000 });

  const extractionStatus = input.extraction.textLayerFound
    ? `A text layer was found. ${input.extraction.characters} characters were extracted across ${input.extraction.pages} page(s).${
        input.extraction.truncated ? " The text was TRUNCATED to fit the analysis budget; later pages may be missing." : ""
      }`
    : "NO text layer could be extracted. The document is almost certainly a scanned image. You cannot read its contents. Do not describe what the document says. Report only that it could not be read, and set documentType to \"unknown\" with an empty findings array.";

  const body = `## Task

Read a medical document that a person uploaded and record what it actually says.

Your job is transcription and light structuring. NOT interpretation.

## Absolute rules on values

- Copy every value EXACTLY as printed, character for character. "10.2" stays "10.2". Do not
  round, reformat, convert units, or "correct" anything.
- Copy reference ranges exactly as printed, including their direction and any symbols.
- If a field is not in the document, leave it absent. Never infer a value. Never supply a
  plausible typical value for a missing test.
- Do not compute or derive new values. Do not average, convert or extrapolate.
- Preserve the units as printed. If a unit is absent, omit the unit field.
- Never fabricate a reference range. If the document gives none, omit it and use status
  "not_stated".

## "status" values

- "below_reference_range" / "above_reference_range" — use ONLY when the document itself states
  the reference range, so the comparison is arithmetic on printed numbers.
- "within_reference_range" — same condition.
- "abnormal_flagged_by_report" — the document's own author flagged it (an H/L marker, "abnormal",
  "low", "high" in the result column).
- "indeterminate" — the value or range is unreadable or ambiguous.
- "not_stated" — no reference range is available for this test.

## "reportRecommendations"

These are recommendations the ORIGINAL DOCUMENT contains — an advice line, a comment section,
a "plan" or "recommendations" section. Copy them close to verbatim. Never generate your own
recommendation here. If the document contains none, return an empty array.

## "evidence"

For each finding, include a short verbatim snippet from the document that supports it. This lets
a reviewer check your work. If you cannot quote anything, leave it out rather than paraphrasing
from general knowledge.

## "warnings"

Use for extraction problems: illegible sections, columns that ran together, a missing second
page, contradictory duplicated values, or text that looks like it belongs to a different patient.
State the problem plainly. Do not guess past it.

## Document metadata

file name: ${input.fileName}
declared media type: ${input.mimeType}
file size: ${humanSize(input.sizeBytes)}
extraction status: ${extractionStatus}

## Output schema

{
  "documentType": "blood_test | radiology_report | pathology_report | prescription | discharge_summary | other | unknown",
  "title": "the document's own title if it has one",
  "findings": [
    {
      "test": "name of the test, measurement or structure as printed",
      "value": "the printed value, verbatim",
      "unit": "the printed unit, verbatim",
      "referenceRange": "the printed reference range, verbatim",
      "status": "below_reference_range | above_reference_range | within_reference_range | abnormal_flagged_by_report | indeterminate | not_stated",
      "evidence": "verbatim snippet from the document",
      "note": "a short note only if the document itself explains this result"
    }
  ],
  "impression": "the document's own impression/conclusion/summary text, verbatim. Omit if absent. Never write your own impression.",
  "reportRecommendations": ["recommendations written in the document itself"],
  "warnings": ["extraction or legibility problems you encountered"]
}

Return up to 60 findings. Prefer completeness of the significant rows over decorative ones; if
you must drop rows, list what you dropped in "warnings".

${jsonOnlyInstruction("documentType, findings, impression, reportRecommendations, warnings")}`;

  const documentBlock = `<UNTRUSTED_MEDICAL_DOCUMENT nonce="${nonce}">
${fence(text.text, "untrusted_user", nonce)}
</UNTRUSTED_MEDICAL_DOCUMENT nonce="${nonce}">`;

  return [
    SYSTEM_ROLE,
    SAFETY_RULES,
    ANTI_INJECTION,
    "You transcribe and structure medical documents. You do not interpret them, diagnose, or advise. Return only JSON.",
    body,
    documentBlock,
    DISCLAIMER_LINE,
  ].join("\n\n");
}

export function documentSystemPrompt(): string {
  return `${SYSTEM_ROLE}

${SAFETY_RULES}

${ANTI_INJECTION}

You transcribe values from medical documents exactly as printed. You never invent, infer or
normalise a value. You never write an impression the document did not contain. Return only JSON.`;
}