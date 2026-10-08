/**
 * Pure text helpers for extracted document content.
 *
 * Split out of extract-text.ts so they carry no `server-only` import and can be
 * unit tested — and, more importantly, reused anywhere text needs normalising.
 */

export const MAX_EXTRACTED_CHARS = 40_000;

/**
 * Normalises whitespace from PDF extraction.
 *
 * ## Why this does not rejoin wrapped lines
 *
 * An earlier version joined a line ending in a lowercase letter to a following
 * line starting with one. That looks obviously right and is genuinely ambiguous:
 *
 *     "Haemoglob"  +  "in 10.2"   →  "Haemoglobin 10.2"   (one token, no space)
 *     "I went home" +  "and slept" →  "I went home and slept" (two tokens, space)
 *
 * Both are the same shape, and the only way to tell them apart is to guess. A
 * wrong guess silently corrupts a laboratory value, which is the single worst
 * failure this application can have. So line structure is preserved exactly and
 * only genuinely safe normalisations are applied:
 *
 *   - soft hyphens removed (they are an artefact, never content)
 *   - CRLF and CR normalised to LF
 *   - runs of spaces and tabs collapsed to one, and trailing whitespace dropped
 *   - runs of three or more blank lines collapsed to one blank line
 *
 * The model receives rows on their own lines, which is both cheaper and easier
 * to quote verbatim than reflowed prose. Where a document really was hard-wrapped
 * mid-word, the prompt instructs the model to reproduce values as printed and the
 * grounding check in lib/ai/stages.ts discards any finding whose value cannot be
 * located in the source text.
 */
export function cleanExtractedText(input: string): string {
  const withoutSoftHyphens = input.replace(/­/g, "");
  const normalizedNewlines = withoutSoftHyphens.replace(/\r\n?/g, "\n");

  const lines = normalizedNewlines
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd());

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}