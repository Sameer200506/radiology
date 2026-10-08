/**
 * Shape coercion for structured AI output.
 *
 * ## Why this exists
 *
 * A live integration test caught a real failure: a model returned
 * `recommendedNextSteps` as an array of plain strings rather than objects, and a
 * red flag with an unrecognised `source`. The Zod schema correctly rejected it,
 * the repair call also produced the wrong shape, and the whole assessment was
 * discarded — a total loss caused by a purely structural mismatch.
 *
 * ## What this is NOT
 *
 * This normalises SHAPE, never CONTENT. It does not add findings, values,
 * explanations or clinical statements. It only re-frames data the model already
 * returned into the shape the schema requires, and only where the mapping is
 * unambiguous.
 *
 * ## Why the timeframes are conservative
 *
 * `recommendedNextSteps[].timeframe` is safety-relevant: it is when the person
 * should act. When a bare string carries no timeframe, the classification falls
 * back to `within_24_hours` rather than `routine_follow_up`, because guessing
 * "routine" for something the model could have meant as urgent could delay care,
 * whereas over-prompting someone to be seen within a day is a safe error.
 */

import { URGENCY_LEVELS, type UrgencyLevel } from "@/types/medical";

type Unknown = Record<string, unknown>;

function isRecord(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TIMEFRAME_PATTERNS: Array<{ pattern: RegExp; timeframe: string }> = [
  { pattern: /\b(immediately|right away|\bnow\b|do not wait|call\s*(?:112|999|911)|emergency)\b/i, timeframe: "immediately" },
  { pattern: /\b(today|within\s*(?:a\s*)?(?:24|one|two)?\s*hours?|24\s*hours?)\b/i, timeframe: "within_24_hours" },
  { pattern: /\b(48\s*hours?|two days|couple of days|few days)\b/i, timeframe: "within_48_hours" },
  { pattern: /\b(this week|within a week|next week|7 days|seven days)\b/i, timeframe: "within_1_week" },
  { pattern: /\b(routine|when convenient|next appointment|at your next|if it persists|follow[- ]up)\b/i, timeframe: "routine_follow_up" },
];

/** Conservative classification. Unknown text becomes `within_24_hours`. */
export function inferTimeframe(text: string): string {
  for (const { pattern, timeframe } of TIMEFRAME_PATTERNS) {
    if (pattern.test(text)) return timeframe;
  }
  return "within_24_hours";
}

/**
 * "today" on its own does not imply urgent care — "contact your GP today" is
 * routine booking. Only explicit urgent-care vocabulary forces that category.
 */
const URGENCY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(emergency|999|112|911|ambulance)\b/i, category: "seek_emergency_care" },
  {
    pattern: /\b(urgent|same[- ]day|a&e|accident and emergency|walk[- ]in|emergency department)\b/i,
    category: "seek_urgent_care",
  },
  { pattern: /\b(book|schedule|appointment|see your gp|see a doctor|consult|contact your)\b/i, category: "book_clinician" },
  { pattern: /\b(monitor|watch|keep a record|track|diary|note down)\b/i, category: "monitor" },
  { pattern: /\b(rest|fluids|hydration|avoid|gently|self[- ]care)\b/i, category: "self_care" },
];

export function inferCategory(text: string): string {
  for (const { pattern, category } of URGENCY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "book_clinician";
}

const RED_FLAG_SOURCES = new Set(["deterministic_rule", "ai_identified", "user_stated"]);
const RED_FLAG_SEVERITIES = new Set(["escalate", "urgent_review", "monitor"]);

const URGENCY_LEVEL_SET = new Set<string>(URGENCY_LEVELS);

const KEY_FINDING_SOURCES = new Set([
  "symptoms",
  "answers",
  "document",
  "imaging",
  "demographics",
  "history",
]);

/**
 * Synonyms observed from real model output, mapped to the canonical enum.
 *
 * A key finding's `source` is provenance the user reads to decide how much to
 * trust it. Silently rewriting an unrecognised value to a canonical one we
 * guessed would fabricate provenance, so anything not in this table is DROPPED
 * rather than relabelled — and the drop is reported to the user.
 */
const KEY_FINDING_SOURCE_SYNONYMS: Record<string, string> = {
  symptom: "symptoms",
  symptoms: "symptoms",
  "reported symptom": "symptoms",
  patient: "symptoms",
  reported: "symptoms",
  complaint: "symptoms",
  answer: "answers",
  answers: "answers",
  questionnaire: "answers",
  follow_up: "answers",
  "follow-up": "answers",
  document: "document",
  documents: "document",
  report: "document",
  reports: "document",
  lab: "document",
  laboratory: "document",
  blood_test: "document",
  "blood test": "document",
  radiology: "document",
  imaging: "imaging",
  image: "imaging",
  xray: "imaging",
  "x-ray": "imaging",
  vision: "imaging",
  demographics: "demographics",
  demographic: "demographics",
  age: "demographics",
  sex: "demographics",
  history: "history",
  medical_history: "history",
  "medical history": "history",
  background: "history",
  "past medical": "history",
};

/** Findings dropped because their provenance could not be established. */
export interface CoercionReport {
  droppedKeyFindings: number;
  droppedNextSteps: number;
  droppedRedFlags: number;
}

const report: CoercionReport = {
  droppedKeyFindings: 0,
  droppedRedFlags: 0,
  droppedNextSteps: 0,
};

/** Resets and reads the tally from the most recent coercion. */
export function takeCoercionReport(): CoercionReport {
  const snapshot = { ...report };
  report.droppedKeyFindings = 0;
  report.droppedRedFlags = 0;
  report.droppedNextSteps = 0;
  return snapshot;
}

/**
 * Coerces a parsed model payload into the shape the schemas expect.
 *
 * Every branch is defensive: if the value is already correct it is returned
 * untouched, and anything unrecognisable is left for Zod to reject. The function
 * never throws and never invents clinical content.
 */
export function coerceAiPayload(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate;
  const out: Unknown = { ...candidate };

  /* --------------------------------------------------- keyFindings source - */
  if (Array.isArray(out.keyFindings)) {
    const inputFindings = out.keyFindings as unknown[];
    const before = inputFindings.length;
    const coercedFindings = inputFindings
      .map((finding) => {
        if (!isRecord(finding)) return finding;
        const coerced: Unknown = { ...finding };
        if (typeof coerced.source === "string") {
          const key = coerced.source.toLowerCase().trim().replace(/\s+/g, "_");
          const canonical =
            KEY_FINDING_SOURCE_SYNONYMS[key] ??
            KEY_FINDING_SOURCE_SYNONYMS[key.replace(/_/g, " ")] ??
            (KEY_FINDING_SOURCES.has(key) ? key : undefined);
          // Unrecognised provenance is dropped rather than guessed at.
          if (!canonical) return null;
          coerced.source = canonical;
        }
        return coerced;
      })
      .filter((finding) => finding !== null);
    out.keyFindings = coercedFindings;
    report.droppedKeyFindings += before - coercedFindings.length;
  }

  /* ---------------------------------------------- recommendedNextSteps ---- */
  if (Array.isArray(out.recommendedNextSteps)) {
    out.recommendedNextSteps = out.recommendedNextSteps
      .map((step) => coerceNextStep(step))
      .filter((step): step is Unknown => step !== null);
  }

  /* ----------------------------------------------------------- redFlags --- */
  if (Array.isArray(out.redFlags)) {
    out.redFlags = out.redFlags
      .map((flag) => coerceRedFlag(flag))
      .filter((flag): flag is Unknown => flag !== null);
  }

  /* ------------------------------------------------------------ urgency --- */
  if (isRecord(out.urgency)) {
    const urgency: Unknown = { ...out.urgency };
    if (typeof urgency.level === "string" && !URGENCY_LEVEL_SET.has(urgency.level)) {
      // "PROMPT-MEDICAL-REVIEW" and "Prompt Medical Review" both mean
      // PROMPT_MEDICAL_REVIEW. Compare on the humanised form in both directions.
      const normalised = urgency.level.toUpperCase().replace(/[-_]+/g, " ").trim();
      const match = URGENCY_LEVELS.find((level) => level.replace(/_/g, " ") === normalised);
      if (match) urgency.level = match satisfies UrgencyLevel;
    }
    out.urgency = urgency;
  }

  /* ------------------------------------------------ possibleExplanations - */
  if (Array.isArray(out.possibleExplanations)) {
    out.possibleExplanations = out.possibleExplanations.map((explanation, index) => {
      if (!isRecord(explanation)) return explanation;
      const coerced: Unknown = { ...explanation };
      if (typeof coerced.rank !== "number") coerced.rank = index + 1;
      if (typeof coerced.whyItMayFit === "string") {
        coerced.whyItMayFit = [coerced.whyItMayFit];
      }
      if (typeof coerced.whatWouldTestIt === "string") {
        coerced.whatWouldTestIt = [coerced.whatWouldTestIt];
      }
      return coerced;
    });
  }

  /* ------------------------------------------------- document findings ---- */
  if (Array.isArray(out.findings)) {
    out.findings = out.findings
      .map((finding) => {
        if (typeof finding === "string") {
          // "Haemoglobin 10.2 g/dL" → test + verbatim value, no invention.
          const parts = finding.trim().split(/\s+/);
          const first = parts.shift();
          if (!first) return null;
          return {
            test: first,
            ...(parts.length > 0 ? { value: parts.join(" ") } : {}),
            // No reference range was supplied, so no comparison was possible.
            // "not_stated" is the honest status; it is never upgraded.
            status: "not_stated",
          };
        }
        return finding;
      })
      .filter((finding) => finding !== null);
  }

  /* --------------------------------------------------- imaging uncertainty */
  if (Array.isArray(out.observations)) {
    out.observations = out.observations.map((observation) => {
      if (!isRecord(observation)) return observation;
      const coerced: Unknown = { ...observation };
      if (typeof coerced.uncertainty === "string") {
        const value = coerced.uncertainty.toLowerCase();
        if (value === "high confidence" || value === "certain") coerced.uncertainty = "low";
        else if (value === "low confidence") coerced.uncertainty = "high";
      }
      if (typeof coerced.limitations === "string") {
        coerced.limitations = [coerced.limitations];
      }
      return coerced;
    });
  }

  return out;
}

function coerceNextStep(step: unknown): Unknown | null {
  if (typeof step === "string") {
    const text = step.trim();
    if (text.length === 0) return null;
    return {
      step: text,
      timeframe: inferTimeframe(text),
      category: inferCategory(text),
    };
  }

  if (!isRecord(step)) return null;

  const out: Unknown = { ...step };
  const label = typeof out.step === "string" ? out.step : "";

  if (typeof out.timeframe !== "string") {
    out.timeframe = inferTimeframe(`${label} ${typeof out.rationale === "string" ? out.rationale : ""}`);
  }
  if (typeof out.category !== "string") {
    out.category = inferCategory(`${label} ${typeof out.rationale === "string" ? out.rationale : ""}`);
  }
// A missing rationale is left missing. Inventing one would be a fabrication.
  return out;
}

function coerceRedFlag(flag: unknown): Unknown | null {
  if (typeof flag === "string") {
    const text = flag.trim();
    return text.length === 0
      ? null
      : { flag: text, why: "", source: "ai_identified", severity: "monitor" };
  }
  if (!isRecord(flag)) return null;

  const out: Unknown = { ...flag };
  if (typeof out.flag !== "string" || out.flag.trim().length === 0) return null;
  if (typeof out.why !== "string") out.why = "";

  // A finding that arrived from the model is by definition AI-identified.
  if (typeof out.source !== "string" || !RED_FLAG_SOURCES.has(out.source)) {
    out.source = "ai_identified";
  }
  if (typeof out.severity !== "string" || !RED_FLAG_SEVERITIES.has(out.severity)) {
    // Default to the lowest-claim level: the deterministic layer owns escalation,
    // so a missing severity must never silently inflate urgency here.
    out.severity = "monitor";
  }
  return out;
}