import { describe, expect, it } from "vitest";

import {
  buildRuleContext,
  describeRuleSet,
  evaluateRedFlags,
  findPhrases,
  isNegated,
  normalizeText,
  RULES,
  scanForUrgentRedFlags,
  THRESHOLDS,
  TRIAGE_RULESET_VERSION,
} from "@/lib/medical/triage";
import type { MedicalCase, UrgencyLevel } from "@/types/medical";

/** Builds a minimally complete case so individual tests only state what matters. */
function makeCase(overrides: Partial<MedicalCase> = {}): Partial<MedicalCase> {
  return {
    demographics: {},
    symptoms: [],
    answers: [],
    medicalHistory: [],
    medications: [],
    allergies: [],
    documents: [],
    freeText: "",
    lifestyle: {},
    ...overrides,
  };
}

/** Cardiac emergency case, used wherever an EMERGENCY result is required. */
function cardiacEmergency(aiProposedLevel?: UrgencyLevel) {
  return evaluateRedFontsCase(aiProposedLevel);
}

function evaluateRedFontsCase(aiProposedLevel?: UrgencyLevel) {
  return evaluateRedFlags(makeCase({ freeText: "I have crushing chest pain and I cannot breathe" }), {
    ...(aiProposedLevel ? { aiProposedLevel } : {}),
  });
}

describe("rule set integrity", () => {
  it("has unique rule ids", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses snake_case ids so the audit trail is stable", () => {
    for (const rule of RULES) {
      expect(rule.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("documents every rule and records its validation status", () => {
    for (const rule of RULES) {
      expect(rule.why.length).toBeGreaterThan(10);
      expect(rule.rationale.length).toBeGreaterThan(20);
      expect(typeof rule.validated).toBe("boolean");
    }
  });

  it("marks no rule as clinically validated", () => {
    // Nothing in this codebase has clinician sign-off. If that ever changes, this
    // test must be updated deliberately rather than drifting silently.
    expect(RULES.every((rule) => rule.validated === false)).toBe(true);
  });

  it("exposes a versioned, serialisable description", () => {
    expect(TRIAGE_RULESET_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    const described = describeRuleSet();
    expect(described).toHaveLength(RULES.length);
    expect(described[0]).toHaveProperty("id");
    expect(described[0]).toHaveProperty("urgency");
    expect(described[0]).toHaveProperty("validated");
  });
});

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("  Chest   PAIN, now!  ")).toBe("chest pain now");
  });

  it("strips accents so accented input still matches rules", () => {
    expect(normalizeText("Fièvre élevée")).toContain("fievre");
  });

  it("removes control and zero-width characters", () => {
    expect(normalizeText("chest\u200B pain\u202E")).toBe("chest pain");
  });
});

describe("negation handling", () => {
  it("detects a preceding negation cue", () => {
    const text = normalizeText("I have no chest pain at all");
    const matches = findPhrases(text, [/\bchest pain\b/gi]);
    expect(matches).toHaveLength(1);
    expect(isNegated(text, matches[0]!.index)).toBe(true);
  });

  it("does not flag a positive mention", () => {
    const text = normalizeText("I have crushing chest pain");
    const matches = findPhrases(text, [/\bchest pain\b/gi]);
    expect(matches).toHaveLength(1);
    expect(isNegated(text, matches[0]!.index)).toBe(false);
  });

  it("suppresses red flags that are negated", () => {
    const result = evaluateRedFlags(
      makeCase({ freeText: "I have no chest pain and no shortness of breath" }),
    );
    expect(result.firedRules).not.toContain("chest_pain");
    expect(result.firedRules).not.toContain("airway_compromise");
    expect(result.level).not.toBe("EMERGENCY");
  });

  it("does not let a negation cue silence a distress statement", () => {
    // "I do not want to live" contains "do not" immediately before the matched
    // phrase. Suppressing it here would be the dangerous direction to fail, so
    // the self-harm rule is not negation-aware.
    const result = evaluateRedFlags(
      makeCase({ freeText: "I do not want to live, I keep thinking about self harm" }),
    );
    expect(result.firedRules).toContain("suicidal_intent");
    expect(result.level).toBe("EMERGENCY");
  });

  it("suppresses a negated answer for a negation-aware rule", () => {
    const result = evaluateRedFlags(
      makeCase({
        answers: [
          { question: "Do you have chest pain?", answer: "No, I do not have any chest pain" },
        ],
      }),
    );
    expect(result.firedRules).not.toContain("chest_pain");
  });
});

describe("emergency red flags", () => {
  const cases: Array<[string, string]> = [
    ["airway compromise", "I cannot breathe properly and I am gasping"],
    ["loss of consciousness", "my father passed out and did not wake for a while"],
    ["stroke features", "sudden one sided weakness and slurred speech since this morning"],
    ["chest pain", "I have crushing central chest pain radiating to my left arm"],
    ["seizure", "he had a seizure and was convulsing on the floor"],
    ["severe bleeding", "the bleeding will not stop and he is soaking through the dressing"],
    ["haematemesis", "I have been vomiting blood twice this morning"],
    ["anaphylaxis", "after eating peanuts my throat is closing and I am wheezing"],
    ["suicidal intent", "I have been thinking about killing myself"],
    ["overdose", "I took too many pills last night"],
    ["sudden severe headache", "worst headache of my life came on within seconds"],
    ["meningeal features", "I have a stiff neck and a high temperature of 39"],
  ];

  for (const [label, text] of cases) {
    it(`escalates to EMERGENCY for ${label}`, () => {
      const result = evaluateRedFlags(makeCase({ freeText: text }));
      expect(result.level).toBe("EMERGENCY");
      expect(result.escalated).toBe(true);
      expect(result.emergencyNotice).toMatch(/emergency/i);
    });
  }

  it("requires both neck stiffness and fever for the meningeal rule", () => {
    const feverOnly = evaluateRedFlags(makeCase({ freeText: "I have a fever and a headache" }));
    expect(feverOnly.firedRules).not.toContain("meningeal_features");

    const both = evaluateRedFlags(
      makeCase({ freeText: "I have a stiff neck and a fever of 39 degrees" }),
    );
    expect(both.firedRules).toContain("meningeal_features");
  });

  it("requires a supporting feature for anaphylaxis", () => {
    const mild = evaluateRedFlags(makeCase({ freeText: "I have a mild rash after a new soap" }));
    expect(mild.firedRules).not.toContain("anaphylaxis");

    const severe = evaluateRedFlags(
      makeCase({ freeText: "throat closing and wheezing after a bee sting, this looks like anaphylaxis" }),
    );
    expect(severe.firedRules).toContain("anaphylaxis");
  });

  it("does not treat a blood-pressure reading as a stroke", () => {
    const result = evaluateRedFlags(
      makeCase({ freeText: "my blood pressure reading was 150 over 95 at the pharmacy" }),
    );
    expect(result.firedRules).not.toContain("stroke_features");
  });
});

describe("urgent rules", () => {
  it("flags a very high reported temperature in celsius", () => {
    const result = evaluateRedFlags(makeCase({ freeText: "temperature was 39.6 C overnight" }));
    expect(result.firedRules).toContain("hyperpyrexia");
    expect(result.level).toBe("URGENT");
  });

  it("flags a very high reported temperature in fahrenheit", () => {
    const result = evaluateRedFlags(makeCase({ freeText: "I had a fever of 103.2 F" }));
    expect(result.firedRules).toContain("hyperpyrexia");
  });

  it("does not flag a temperature just below the threshold", () => {
    const result = evaluateRedFontsCaseBelowThreshold();
    expect(result.firedRules).not.toContain("hyperpyrexia");
  });

  function evaluateRedFontsCaseBelowThreshold() {
    return evaluateRedFlags(makeCase({ freeText: `temperature was ${THRESHOLDS.urgentTemperatureC - 0.1} C` }));
  }

  it("flags a low reported oxygen saturation", () => {
    const result = evaluateRedFlags(makeCase({ freeText: "my pulse oximeter read SpO2 89%" }));
    expect(result.firedRules).toContain("low_oxygen_saturation");
  });

  it("escalates fever in a very young infant", () => {
    const infant = evaluateRedFlags(
      makeCase({ demographics: { age: 2 }, freeText: "my baby has had a fever since this morning" }),
    );
    expect(infant.firedRules).toContain("infant_with_fever");
    expect(infant.level).toBe("URGENT");
  });

  it("does not apply the infant rule to an older child", () => {
    const child = evaluateRedFlags(
      makeCase({
        demographics: { age: 7 },
        freeText: "my child has had a fever since this morning",
      }),
    );
    expect(child.firedRules).not.toContain("infant_with_fever");
  });

  it("escalates new confusion in an older adult", () => {
    const result = evaluateRedFlags(
      makeCase({
        demographics: { age: 78 },
        freeText: "my mother is suddenly very confused today",
      }),
    );
    expect(result.firedRules).toContain("older_adult_confusion");
    expect(result.level).toBe("URGENT");
  });

  it("requires at least two dehydration signs", () => {
    const one = evaluateRedFlags(makeCase({ freeText: "I have not passed urine today" }));
    expect(one.firedRules).not.toContain("dehydration_signs");

    const two = evaluateRedFlags(
      makeCase({ freeText: "I have not passed urine since yesterday and I am dizzy when standing" }),
    );
    expect(two.firedRules).toContain("dehydration_signs");
  });
});

describe("monitor rules", () => {
  it("is included by default but excluded from the pre-flight scan", () => {
    const full = evaluateRedFlags(makeCase({ freeText: "I have a mild fever and a cough" }));
    expect(full.firedRules).toContain("fever_present");

    const scan = scanForUrgentRedFlags({ symptoms: ["Fever", "Cough"] });
    expect(scan.firedRules).not.toContain("fever_present");
  });

  it("flags a symptom lasting beyond the prolonged threshold", () => {
    const result = evaluateRedFlags(
      makeCase({ symptoms: [{ name: "Cough", duration: "5 weeks", source: "user_selected" }] }),
    );
    expect(result.firedRules).toContain("prolonged_symptom");
  });

  it("does not flag a short duration", () => {
    const result = evaluateRedFlags(
      makeCase({ symptoms: [{ name: "Cough", duration: "3 days", source: "user_selected" }] }),
    );
    expect(result.firedRules).not.toContain("prolonged_symptom");
  });

  it("understands weeks as well as days", () => {
    expect(THRESHOLDS.prolongedSymptomDays).toBe(21);
    const weeks = evaluateRedFlags(
      makeCase({ symptoms: [{ name: "Cough", duration: "4 weeks", source: "user_selected" }] }),
    );
    expect(weeks.firedRules).toContain("prolonged_symptom");
  });
});

describe("the safety layer can only raise urgency", () => {
  it("keeps a higher AI suggestion", () => {
    const result = evaluateRedFlags(makeCase({ freeText: "I have a mild sore throat" }), {
      aiProposedLevel: "URGENT",
    });
    expect(result.level).toBe("URGENT");
    expect(result.escalated).toBe(false);
  });

  it("overrides a lower AI suggestion when a rule fires", () => {
    const result = cardiacEmergency("ROUTINE");
    expect(result.level).toBe("EMERGENCY");
    expect(result.escalated).toBe(true);
  });

  it("never lowers an EMERGENCY", () => {
    const result = cardiacEmergency("ROUTINE");
    expect(result.level).toBe("EMERGENCY");
    expect(result.firedRules).toContain("chest_pain");
  });

  it("records why urgency was raised", () => {
    const result = cardiacEmergency();
    expect(result.notes.some((note) => note.includes("deterministic"))).toBe(true);
  });
});

describe("buildRuleContext", () => {
  it("reads numbers out of answers", () => {
    const ctx = buildRuleContext(
      makeCase({
        answers: [
          { question: "Highest temperature?", answer: "39.5 degrees celsius" },
          { question: "Oxygen saturation?", answer: "SpO2 91%" },
        ],
      }),
    );

    expect(ctx.temperatureC).toBeCloseTo(39.5, 1);
    expect(ctx.spo2).toBe(91);
  });

  it("converts fahrenheit readings to celsius", () => {
    const ctx = buildRuleContext(makeCase({ freeText: "temperature 103 f" }));
    // 103 °F is 39.44 °C, which clears the hyperpyrexia threshold.
    expect(ctx.temperatureC).toBeTypeOf("number");
    expect(ctx.temperatureC as number).toBeGreaterThanOrEqual(39.4);
    expect(ctx.temperatureC as number).toBeLessThanOrEqual(39.5);
    expect(THRESHOLDS.urgentTemperatureC).toBeLessThanOrEqual(ctx.temperatureC as number);
  });

  it("does not match a rule pattern against question text alone", () => {
    // The application asks the question; the person never reported it. Matching
    // question text would fire a red flag nobody described.
    const result = evaluateRedFlags(
      makeCase({
        answers: [{ question: "Do you have chest pain?", answer: "No" }],
      }),
    );
    expect(result.firedRules).not.toContain("chest_pain");
  });

  it("treats an affirmative answer as an assertion of the question", () => {
    const result = evaluateRedFlags(
      makeCase({ answers: [{ question: "Do you have chest pain?", answer: "Yes" }] }),
    );
    expect(result.firedRules).toContain("chest_pain");
  });

  it("does not treat a question containing 'any' as a negation", () => {
    // Regression: "Any breathing difficulty? I cannot catch my breath" must fire.
    const scan = scanForUrgentRedFlags({
      symptoms: ["Fever"],
      answers: [{ question: "Any breathing difficulty?", answer: "I cannot catch my breath" }],
    });
    expect(scan.level).toBe("EMERGENCY");
  });

  it("ignores implausible numbers", () => {
    const ctx = buildRuleContext(makeCase({ freeText: "temperature 999 degrees" }));
    expect(ctx.temperatureC).toBeUndefined();
  });

  it("picks up age from demographics", () => {
    const ctx = buildRuleContext(makeCase({ demographics: { age: 4 } }));
    expect(ctx.age).toBe(4);
  });

  it("reads document findings into the context", () => {
    const ctx = buildRuleContext(
      makeCase({
        documents: [
          {
            id: "d1",
            kind: "blood_test",
            fileName: "labs.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            uploadStatus: "analyzed",
            analysis: {
              documentType: "blood_test",
              findings: [
                { test: "Potassium", value: "6.8", unit: "mmol/L", status: "above_reference_range" },
              ],
              reportRecommendations: [],
              warnings: [],
              extraction: { characters: 10, pages: 1, textLayerFound: true },
              truncated: false,
            },
          },
        ],
      }),
    );
    expect(ctx.text).toContain("potassium");
  });
});

describe("emergency notice content", () => {
  it("directs the user to emergency services", () => {
    const result = cardiacEmergency();
    expect(result.emergencyNotice).toMatch(/emergency/i);
  });

  it("adds crisis wording for a self-harm statement", () => {
    const result = evaluateRedFlags(
      makeCase({ freeText: "I do not want to live, I keep thinking about self harm" }),
    );
    expect(result.emergencyNotice).toMatch(/crisis helpline/i);
  });

  it("produces no notice when urgency is low", () => {
    const result = evaluateRedFlags(makeCase({ freeText: "I have a slightly sore throat" }));
    expect(result.emergencyNotice).toBeNull();
  });
});

describe("no false emergencies on benign input", () => {
  it("stays non-urgent for an ordinary complaint", () => {
    const result = evaluateRedFlags(
      makeCase({
        demographics: { age: 30 },
        freeText: "I have had a mild headache for two days after a long week at work.",
        symptoms: [{ name: "Headache", duration: "2 days", severity: "Mild", source: "user_selected" }],
      }),
    );

    expect(result.level).not.toBe("EMERGENCY");
    expect(result.firedRules).not.toContain("chest_pain");
    expect(result.firedRules).not.toContain("stroke_features");
  });

  it("does not fire on an empty case", () => {
    const result = evaluateRedFlags(makeCase());
    expect(result.level).not.toBe("EMERGENCY");
    expect(result.emergencyNotice).toBeNull();
  });
});

describe("scanForUrgentRedFlags", () => {
  it("detects an emergency from selected symptoms alone", () => {
    const scan = scanForUrgentRedFlags({ symptoms: ["Chest pain", "Shortness of breath"] });
    expect(scan.level).toBe("EMERGENCY");
    expect(scan.escalated).toBe(true);
  });

  it("reads answers as well as symptoms", () => {
    const scan = scanForUrgentRedFlags({
      symptoms: ["Fever"],
      answers: [{ question: "Any breathing difficulty?", answer: "I cannot catch my breath" }],
    });
    expect(scan.level).toBe("EMERGENCY");
  });

  it("respects age for the infant rule", () => {
    const scan = scanForUrgentRedFlags({ symptoms: ["Fever"], age: 1 });
    expect(scan.level).toBe("URGENT");
  });
});