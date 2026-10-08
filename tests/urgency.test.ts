import { describe, expect, it } from "vitest";

import { coerceLevel, reconcileUrgency } from "@/lib/medical/reconcile-urgency";
import { evaluateRedFlags } from "@/lib/medical/triage";
import { maxUrgency, urgencyPresentation } from "@/lib/medical/urgency";
import { URGENCY_LEVELS, urgencyRank, type UrgencyLevel } from "@/types/medical";
import type { RedFlagFinding } from "@/types/assessment";

/**
 * The invariant under test: the deterministic safety layer is a FLOOR. The model
 * may raise urgency; it must never lower it. Getting this backwards would allow
 * a model to talk a user out of emergency care.
 */

function ai(
  level: UrgencyLevel,
  redFlags: RedFlagFinding[] = [],
  reason = "Model reasoning.",
) {
  return {
    urgency: { level, reason },
    redFlags,
  };
}

function rule(flag: string, severity: RedFlagFinding["severity"] = "escalate"): RedFlagFinding {
  return { flag, why: "Because.", source: "deterministic_rule", severity };
}

describe("coerceLevel", () => {
  it("passes through every valid level", () => {
    for (const level of URGENCY_LEVELS) {
      expect(coerceLevel(level)).toBe(level);
    }
  });

  it("falls back to NON_URGENT for an unknown value", () => {
    expect(coerceLevel("VERY_URGENT")).toBe("NON_URGENT");
    expect(coerceLevel("")).toBe("NON_URGENT");
  });
});

describe("reconcileUrgency — the model may raise", () => {
  it("keeps a higher AI level", () => {
    const merged = reconcileUrgency(ai("URGENT"), { level: "NON_URGENT", redFlags: [] });
    expect(merged.urgency.level).toBe("URGENT");
    expect(merged.urgency.overriddenBySafetyRules).toBe(false);
    expect(merged.urgency.reason).toBe("Model reasoning.");
  });

  it("keeps a higher AI level above the highest deterministic one", () => {
    const merged = reconcileUrgency(ai("EMERGENCY"), { level: "URGENT", redFlags: [] });
    expect(merged.urgency.level).toBe("EMERGENCY");
    expect(merged.urgency.overriddenBySafetyRules).toBe(false);
  });

  it("reports the AI's suggestion for transparency", () => {
    const merged = reconcileUrgency(ai("URGENT"), { level: "ROUTINE", redFlags: [] });
    expect(merged.urgency.aiSuggestedLevel).toBe("URGENT");
  });
});

describe("reconcileUrgency — the model may not lower", () => {
  const cases: Array<[UrgencyLevel, UrgencyLevel]> = [
    ["ROUTINE", "NON_URGENT"],
    ["ROUTINE", "PROMPT_MEDICAL_REVIEW"],
    ["NON_URGENT", "URGENT"],
    ["PROMPT_MEDICAL_REVIEW", "EMERGENCY"],
    ["URGENT", "EMERGENCY"],
  ];

  for (const [model, deterministic] of cases) {
    it(`refuses to downgrade ${model} to ${deterministic}`, () => {
      const merged = reconcileUrgency(ai(model), { level: deterministic, redFlags: [] });
      expect(merged.urgency.level).toBe(deterministic);
      expect(merged.urgency.overriddenBySafetyRules).toBe(true);
      expect(merged.urgency.aiSuggestedLevel).toBe(model);
    });
  }

  it("states in the reason why the level was raised", () => {
    const merged = reconcileUrgency(ai("ROUTINE"), {
      level: "EMERGENCY",
      redFlags: [rule("Chest pain")],
    });
    expect(merged.urgency.reason).toMatch(/deterministic safety rules/i);
    expect(merged.urgency.reason).toMatch(/EMERGENCY/);
  });

  it("keeps the model's reasoning alongside the override", () => {
    const merged = reconcileUrgency(ai("ROUTINE", [], "The model saw nothing urgent."), {
      level: "EMERGENCY",
      redFlags: [],
    });
    expect(merged.urgency.reason).toContain("The model saw nothing urgent.");
  });

  it("treats an equal level as no override", () => {
    const merged = reconcileUrgency(ai("EMERGENCY"), { level: "EMERGENCY", redFlags: [] });
    expect(merged.urgency.overriddenBySafetyRules).toBe(false);
    expect(merged.urgency.level).toBe("EMERGENCY");
  });
});

describe("reconcileUrgency — red flags are unioned, never replaced", () => {
  it("retains every deterministic finding", () => {
    const merged = reconcileUrgency(ai("ROUTINE"), {
      level: "EMERGENCY",
      redFlags: [rule("Chest pain"), rule("Airway compromise")],
    });
    expect(merged.redFlags).toHaveLength(2);
    expect(merged.redFlags.map((f) => f.source)).toEqual([
      "deterministic_rule",
      "deterministic_rule",
    ]);
  });

  it("keeps an AI finding that the rules did not raise", () => {
    const merged = reconcileUrgency(
      ai("URGENT", [{ flag: "Rising fever", why: "Trend is worsening.", source: "ai_identified", severity: "urgent_review" }]),
      { level: "NON_URGENT", redFlags: [rule("Fever present", "monitor")] },
    );
    expect(merged.redFlags).toHaveLength(2);
  });

  it("de-duplicates the same flag found by both", () => {
    const merged = reconcileUrgency(
      ai("EMERGENCY", [{ flag: "chest pain", why: "…", source: "ai_identified", severity: "escalate" }]),
      { level: "EMERGENCY", redFlags: [rule("Chest pain")] },
    );
    expect(merged.redFlags).toHaveLength(1);
    expect(merged.redFlags[0]?.source).toBe("deterministic_rule");
  });

  it("matches duplicates case-insensitively and ignoring surrounding space", () => {
    const merged = reconcileUrgency(
      ai("EMERGENCY", [{ flag: "  CHEST PAIN ", why: "…", source: "ai_identified", severity: "escalate" }]),
      { level: "EMERGENCY", redFlags: [rule("Chest Pain")] },
    );
    expect(merged.redFlags).toHaveLength(1);
  });

  it("returns an empty array when neither layer found anything", () => {
    const merged = reconcileUrgency(ai("ROUTINE"), { level: "ROUTINE", redFlags: [] });
    expect(merged.redFlags).toEqual([]);
  });
});

describe("end-to-end: a real emergency case cannot be downgraded", () => {
  it("keeps EMERGENCY even when the model says ROUTINE", () => {
    const triage = evaluateRedFlags({
      demographics: { age: 61 },
      symptoms: [{ name: "Chest pain", duration: "40 minutes", source: "user_selected" }],
      answers: [],
      medicalHistory: [],
      medications: [],
      allergies: [],
      documents: [],
      freeText: "crushing central chest pain and I am struggling to breathe",
      lifestyle: {},
    });

    expect(triage.level).toBe("EMERGENCY");

    const merged = reconcileUrgency(ai("ROUTINE", [], "No red flags identified."), {
      level: triage.level,
      redFlags: triage.redFlags,
    });

    expect(merged.urgency.level).toBe("EMERGENCY");
    expect(merged.urgency.overriddenBySafetyRules).toBe(true);
    expect(merged.redFlags.length).toBeGreaterThan(0);
  });

  it("holds across every model level below the deterministic one", () => {
    const triage = evaluateRedFlags({
      demographics: {},
      symptoms: [],
      answers: [],
      medicalHistory: [],
      medications: [],
      allergies: [],
      documents: [],
      freeText: "I cannot breathe and I am passing out",
      lifestyle: {},
    });

    for (const level of URGENCY_LEVELS) {
      if (urgencyRank(level) >= urgencyRank(triage.level)) continue;
      const merged = reconcileUrgency(ai(level), { level: triage.level, redFlags: triage.redFlags });
      expect(merged.urgency.level).toBe(triage.level);
    }
  });
});

describe("urgency helpers", () => {
  it("orders levels from least to most urgent", () => {
    expect(urgencyRank("ROUTINE" as UrgencyLevel)).toBeLessThan(urgencyRank("EMERGENCY"));
    expect(urgencyRank("NON_URGENT")).toBeLessThan(urgencyRank("PROMPT_MEDICAL_REVIEW"));
  });

  it("maxUrgency picks the more urgent level", () => {
    expect(maxUrgency("ROUTINE", "URGENT")).toBe("URGENT");
    expect(maxUrgency("EMERGENCY", "ROUTINE")).toBe("EMERGENCY");
    expect(maxUrgency("URGENT", "URGENT")).toBe("URGENT");
  });

  it("gives every level a text label and an icon for non-colour communication", () => {
    for (const level of URGENCY_LEVELS) {
      const presentation = urgencyPresentation(level);
      // The displayed label is humanised for reading ("NON_URGENT" → "NON-URGENT",
      // "PROMPT_MEDICAL_REVIEW" → "PROMPT MEDICAL REVIEW"), so compare on the
      // words rather than the enum spelling.
      expect(presentation.label.replace(/[-_\s]+/g, "_")).toBe(level as string);
      expect(presentation.description.length).toBeGreaterThan(20);
      expect(presentation.icon).toBeDefined();
      expect(presentation.srAnnouncement).toMatch(/Urgency level \d of 5/);
    }
  });
});