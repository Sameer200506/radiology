import { describe, expect, it } from "vitest";

import { coerceAiPayload, inferCategory, inferTimeframe } from "@/lib/ai/coerce";
import { assessmentAiOutputSchema, documentAnalysisSchema } from "@/lib/ai/schemas";

/**
 * Coercion normalises SHAPE, never CONTENT. These tests pin both halves:
 * ambiguous model output must be accepted, and nothing may be invented.
 */

const VALID_NEXT_STEP = {
  step: "Contact a healthcare professional within 24 hours.",
  timeframe: "within_24_hours",
  category: "book_clinician",
  rationale: "Prolonged symptoms warrant review.",
};

interface Payload {
  summary: string;
  keyFindings: unknown[];
  symptomAnalysis: unknown[];
  documentFindings: string[];
  imagingObservations: string[];
  possibleExplanations: Array<Record<string, unknown>>;
  redFlags: Array<Record<string, unknown>>;
  urgency: { level: string; reason: string };
  recommendedNextSteps: Array<Record<string, unknown>>;
  questionsForClinician: string[];
  limitations: string[];
  evidenceUsed: string[];
  missingInformation: string[];
}

function payload(overrides: Record<string, unknown> = {}): Payload {
  return {
    summary: "The reported symptoms may be consistent with a self-limiting infection.",
    keyFindings: [],
    symptomAnalysis: [],
    documentFindings: [],
    imagingObservations: [],
    possibleExplanations: [
      {
        rank: 1,
        explanation: "Viral respiratory infection",
        whyItMayFit: ["Fever", "Cough"],
        whatWouldTestIt: ["Clinical review"],
        confidenceNote: "Cannot be confirmed from this information alone.",
      },
    ],
    redFlags: [],
    urgency: { level: "NON_URGENT", reason: "Nothing urgent was described." },
    recommendedNextSteps: [VALID_NEXT_STEP],
    questionsForClinician: [],
    limitations: ["No examination was performed."],
    evidenceUsed: [],
    missingInformation: [],
    ...overrides,
  };
}

describe("inferTimeframe", () => {
  it("recognises immediate action", () => {
    expect(inferTimeframe("Call 112 immediately")).toBe("immediately");
    expect(inferTimeframe("Go to the emergency department now")).toBe("immediately");
  });

  it("recognises same-day action", () => {
    expect(inferTimeframe("Be seen today")).toBe("within_24_hours");
    expect(inferTimeframe("Contact someone within 24 hours")).toBe("within_24_hours");
  });

  it("recognises a few days out", () => {
    expect(inferTimeframe("Speak to someone in 48 hours")).toBe("within_48_hours");
  });

  it("recognises a week out", () => {
    expect(inferTimeframe("Book an appointment this week")).toBe("within_1_week");
  });

  it("recognises routine", () => {
    expect(inferTimeframe("Mention it at your next routine appointment")).toBe("routine_follow_up");
  });

  it("defaults conservatively rather than to routine", () => {
    // Guessing "routine" for something that might be urgent could delay care.
    expect(inferTimeframe("Do the sensible thing")).toBe("within_24_hours");
    expect(inferTimeframe("")).toBe("within_24_hours");
  });

  it("prefers the most urgent reading when two appear", () => {
    expect(inferTimeframe("If not better within a week, contact someone today")).toBe(
      "within_24_hours",
    );
  });
});

describe("inferCategory", () => {
  it("maps emergency wording", () => {
    expect(inferCategory("Call 999 straight away")).toBe("seek_emergency_care");
  });
  it("maps urgent wording", () => {
    expect(inferCategory("Attend urgent care today")).toBe("seek_urgent_care");
  });
  it("maps booking wording", () => {
    expect(inferCategory("Book an appointment with your GP")).toBe("book_clinician");
  });
  it("maps monitoring wording", () => {
    expect(inferCategory("Monitor your temperature and keep a record")).toBe("monitor");
  });
  it("falls back to booking a clinician", () => {
    expect(inferCategory("Consider what to do next")).toBe("book_clinician");
  });
});

describe("coerceAiPayload — recommendedNextSteps as strings", () => {
  it("converts a string into a schema-valid step", () => {
    const result = coerceAiPayload(
      payload({ recommendedNextSteps: ["Contact a healthcare professional today to discuss this."] }),
    );
    const step = (result as Payload).recommendedNextSteps[0]!;
    expect(typeof step).toBe("object");
    expect(step.timeframe).toBe("within_24_hours");
    expect(step.category).toBe("book_clinician");
  });

  it("keeps the original wording verbatim", () => {
    const text = "Contact a healthcare professional today to discuss this.";
    const result = coerceAiPayload(payload({ recommendedNextSteps: [text] }));
    expect((result as Payload).recommendedNextSteps[0]!.step).toBe(text);
  });

  it("omits a rationale rather than inventing one", () => {
    // A bare instruction carries no justification, so none is written.
    const result = coerceAiPayload(payload({ recommendedNextSteps: ["Book an appointment this week."] }));
    expect((result as Payload).recommendedNextSteps[0]!.rationale).toBeUndefined();
  });

  it("makes the payload validate", () => {
    const result = coerceAiPayload(
      payload({
        recommendedNextSteps: [
          "Call 999 immediately if symptoms worsen.",
          "Track your temperature and note it down as a routine daily habit.",
        ],
      }),
    );
    const parsed = assessmentAiOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recommendedNextSteps[0]?.timeframe).toBe("immediately");
      expect(parsed.data.recommendedNextSteps[1]?.timeframe).toBe("routine_follow_up");
    }
  });

  it("drops blank strings rather than emitting empty steps", () => {
    const result = coerceAiPayload(payload({ recommendedNextSteps: ["", "   ", "Do something."] }));
    expect((result as Payload).recommendedNextSteps).toHaveLength(1);
  });

  it("preserves a fully-formed step untouched", () => {
    const result = coerceAiPayload(payload());
    expect((result as Payload).recommendedNextSteps[0]).toEqual(VALID_NEXT_STEP);
  });

  it("does not overwrite a timeframe the model did supply", () => {
    const result = coerceAiPayload(
      payload({
        recommendedNextSteps: [
          { step: "See someone soon.", timeframe: "routine_follow_up", category: "monitor" },
        ],
      }),
    );
    expect((result as Payload).recommendedNextSteps[0]!.timeframe).toBe("routine_follow_up");
  });
});

describe("coerceAiPayload — red flags", () => {
  it("converts a string flag without inflating urgency", () => {
    const result = coerceAiPayload(payload({ redFlags: ["Possible dehydration"] }));
    const flag = (result as Payload).redFlags[0]!;
    expect(flag.flag).toBe("Possible dehydration");
    expect(flag.source).toBe("ai_identified");
    // Lowest-claim severity: escalation belongs to the deterministic layer.
    expect(flag.severity).toBe("monitor");
  });

  it("repairs an invalid source", () => {
    const result = coerceAiPayload(
      payload({ redFlags: [{ flag: "X", why: "y", source: "vibes", severity: "escalate" }] }),
    );
    expect((result as Payload).redFlags[0]!.source).toBe("ai_identified");
    expect((result as Payload).redFlags[0]!.severity).toBe("escalate");
  });

  it("defaults an unknown severity to monitor, never escalate", () => {
    const result = coerceAiPayload(
      payload({ redFlags: [{ flag: "X", why: "y", source: "ai_identified", severity: "apocalyptic" }] }),
    );
    expect((result as Payload).redFlags[0]!.severity).toBe("monitor");
  });

  it("never relabels a deterministic finding as AI-identified", () => {
    const result = coerceAiPayload(
      payload({ redFlags: [{ flag: "X", why: "y", source: "deterministic_rule", severity: "escalate" }] }),
    );
    expect((result as Payload).redFlags[0]!.source).toBe("deterministic_rule");
  });

  it("drops a flag with no text", () => {
    const result = coerceAiPayload(payload({ redFlags: ["", "Real flag"] }));
    expect((result as Payload).redFlags).toHaveLength(1);
  });
});

describe("coerceAiPayload — urgency", () => {
  it("accepts a correctly spelled level", () => {
    const result = coerceAiPayload(payload({ urgency: { level: "URGENT", reason: "…" } }));
    expect((result as Payload).urgency.level).toBe("URGENT");
  });

  it("normalises a hyphenated level", () => {
    const result = coerceAiPayload(
      payload({ urgency: { level: "PROMPT-MEDICAL-REVIEW", reason: "…" } }),
    );
    expect((result as Payload).urgency.level).toBe("PROMPT_MEDICAL_REVIEW");
  });

  it("leaves an unrecognisable level for Zod to reject", () => {
    const result = coerceAiPayload(payload({ urgency: { level: "VERY_BAD", reason: "…" } }));
    expect((result as Payload).urgency.level).toBe("VERY_BAD");
    expect(assessmentAiOutputSchema.safeParse(result).success).toBe(false);
  });
});

describe("coerceAiPayload — explanations", () => {
  it("numbers missing ranks by position", () => {
    const result = coerceAiPayload(
      payload({
        possibleExplanations: [
          { explanation: "A", whyItMayFit: ["x"], whatWouldTestIt: [], confidenceNote: "…" },
          { explanation: "B", whyItMayFit: ["y"], whatWouldTestIt: [], confidenceNote: "…" },
        ],
      }),
    );
    const list = (result as Payload).possibleExplanations;
    expect(list[0]!.rank).toBe(1);
    expect(list[1]!.rank).toBe(2);
  });

  it("wraps a string whyItMayFit into an array", () => {
    const result = coerceAiPayload(
      payload({
        possibleExplanations: [
          { rank: 1, explanation: "A", whyItMayFit: "Fever", confidenceNote: "…" },
        ],
      }),
    );
    expect((result as Payload).possibleExplanations[0]!.whyItMyFit).toBeUndefined();
    expect((result as Payload).possibleExplanations[0]!.whyItMayFit).toEqual(["Fever"]);
  });
});

describe("coerceAiPayload — document findings", () => {
  it("splits a bare finding string into test and verbatim value", () => {
    const result = coerceAiPayload({
      documentType: "blood_test",
      findings: ["Haemoglobin 10.2 g/dL"],
      reportRecommendations: [],
      warnings: [],
    });
    const finding = (result as { findings: Array<{ test: string; value?: string }> }).findings[0];
    expect(finding?.test).toBe("Haemoglobin");
    expect(finding?.value).toBe("10.2 g/dL");
  });

  it("makes a string-findings document validate", () => {
    const result = coerceAiPayload({
      documentType: "blood_test",
      findings: ["Haemoglobin 10.2 g/dL", "Sodium 142 mmol/L"],
      reportRecommendations: [],
      warnings: [],
    });
    expect(documentAnalysisSchema.safeParse(result).success).toBe(true);
  });
});

describe("coerceAiPayload — imaging", () => {
  it("inverts an inverted confidence scale", () => {
    const result = coerceAiPayload({
      observations: [
        { observation: "x", uncertainty: "high confidence", evidence: "e", limitations: [] },
      ],
    });
    expect(
      (result as { observations: Array<{ uncertainty: string }> }).observations[0]?.uncertainty,
    ).toBe("low");
  });

  it("wraps a string limitations into an array", () => {
    const result = coerceAiPayload({
      observations: [{ observation: "x", uncertainty: "low", evidence: "e", limitations: "single view" }],
    });
    expect(
      (result as { observations: Array<{ limitations: string[] }> }).observations[0]?.limitations,
    ).toEqual(["single view"]);
  });
});

describe("coerceAiPayload — robustness", () => {
  it("returns non-objects untouched", () => {
    expect(coerceAiPayload(null)).toBeNull();
    expect(coerceAiPayload("string")).toBe("string");
    expect(coerceAiPayload(42)).toBe(42);
  });

  it("never throws on malformed input", () => {
    const hostile = {
      recommendedNextSteps: { not: "an array" },
      redFlags: "nope",
      possibleExplanations: [null, 5, { rank: "x" }],
      urgency: "nope",
      findings: 12,
      observations: "nope",
    };
    expect(() => coerceAiPayload(hostile)).not.toThrow();
  });

  it("leaves arrays of junk empty rather than emitting garbage", () => {
    const result = coerceAiPayload({ redFlags: [null, 5, { why: "no flag text" }] });
    expect((result as { redFlags: unknown[] }).redFlags).toHaveLength(0);
  });

  it("does not invent findings when the array is absent", () => {
    const result = coerceAiPayload({ documentType: "blood_test", reportRecommendations: [], warnings: [] });
    expect((result as { findings?: unknown }).findings).toBeUndefined();
  });
});