/**
 * JSON extraction from model output.
 *
 * Kept in its own module, free of any server-only import, because it is pure
 * string handling and needs to be unit testable without credentials.
 *
 * Handles the three things models actually do: return clean JSON, wrap it in a
 * ```json fence, or wrap it in prose. Deliberately does NOT attempt to repair
 * malformed JSON — that is what the repair call in openrouter.ts is for.
 */

export class JsonExtractionError extends Error {
  /** Truncated excerpt of the offending output, for server-side logging only. */
  readonly excerpt: string;

  constructor(message: string, excerpt: string) {
    super(message);
    this.name = "JsonExtractionError";
    this.excerpt = excerpt;
  }
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to the more forgiving strategies below
    }
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  throw new JsonExtractionError(
    "The AI service returned a response that could not be read.",
    trimmed.slice(0, 300),
  );
}