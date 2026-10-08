import { describe, expect, it } from "vitest";

import {
  buildReportDocument,
  buildReportSections,
  REPORT_DISCLAIMER,
  type ReportInput,
} from "@/lib/ai/prompts/report";
import { buildEmptyCase } from "@/lib/medical/empty-case";
import { buildDemoCase } from "@/lib/medical/demo-data";
import type { AssessmentResult, TriageResult } from "@/types/assessment";
import type { MedicalCase } from "@/types/medical";

/**
 * The report is rendered deterministically from the validated assessment, so it
 * performs no model call and must reproduce exactly what the user saw. These
 * tests pin the required section list from the product spec and check that
 * factual sections restate user input rather than model output.
 */

const RESULT: AssessmentResult = {
  summary: "The reported symptoms may be consistent with a self-limiting infection.",
  keyFindings: [
    { title: "Fever recorded", detail: "A temperature of 38.4 °C was reported.", source: "answers" },
  ],
  symptomAnalysis: [{ symptom: "Cough", interpretation: "A six-day course, currently unchanging." }],
  documentFindings: ["C-reactive protein 24 mg/L with a reference range of under 5."],
  imagingObservations: [],
  possibleExplanations: [
    {
      rank: 1,
      explanation: "Viral respiratory infection",
      whyItMayFit: ["Fever", "Cough", "Recent exposure"],
      whatWouldTestIt: ["Clinical review"],
      confidenceNote: "Cannot be confirmed from this information alone.",
    },
  ],
  redFlags: [],
  urgency: {
    level: "PROMPT_MEDICAL_REVIEW",
    reason: "Symptoms have persisted for nine days.",
    overriddenBySafetyRules: false,
    aiSuggestedLevel: "PROMPT_MEDICAL_REVIEW",
  },
  recommendedNextSteps: [
    {
      step: "Contact a healthcare professional within 24 hours.",
      timeframe: "within_24_hours",
      category: "book_clinician",
      rationale: "Prolonged symptoms warrant review.",
    },
  ],
  questionsForClinician: ["Could this need a repeat chest X-ray?"],
  limitations: ["No examination was performed."],
  evidenceUsed: ["reported symptoms"],
  missingInformation: [],
};

const TRIAGE: TriageResult = {
  level: "PROMPT_MEDICAL_REVIEW",
  escalated: false,
  redFlags: [],
  emergencyNotice: null,
  firedRules: ["fever_present"],
  notes: [],
};

function makeInput(caseData: MedicalCase, overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    assessmentId: "abc123",
    reportTitle: "MedAssist AI — Health Information Assessment",
    createdAt: "2026-04-01T10:00:00.000Z",
    patientLabel: "Private user account",
    result: RESULT,
    triage: TRIAGE,
    caseData,
    evidenceSummary: RESULT.evidenceUsed,
    missingSummary: RESULT.missingInformation,
    modelLabel: "test-model",
    rulesetVersion: "2026.06.01",
    ...overrides,
  };
}

function section(input: ReportInput, id: string) {
  return buildReportSections(input).find((section) => section.id === id);
}

describe("report — required sections", () => {
  const sections = buildReportSections(makeInput(buildDemoCase("respiratory")));

  it("includes every section the report must contain", () => {
    const ids = sections.map((section) => section.id);
    for (const required of [
      "patient_information",
      "presenting_symptoms",
      "relevant_history",
      "summary",
      "urgency",
      "key_findings",
      "symptom_analysis",
      "possible_explanations",
      "next_steps",
      "clinician_questions",
      "limitations",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("orders the factual sections first and the caveats last", () => {
    const ids = sections.map((section) => section.id);
    expect(ids.indexOf("patient_information")).toBeLessThan(ids.indexOf("presenting_symptoms"));
    expect(ids.indexOf("presenting_symptoms")).toBeLessThan(ids.indexOf("relevant_history"));
    expect(ids.indexOf("relevant_history")).toBeLessThan(ids.indexOf("summary"));
    expect(ids.indexOf("limitations")).toBeGreaterThan(ids.indexOf("next_steps"));
  });

  it("gives every section a title and non-empty content", () => {
    for (const item of sections) {
      expect(item.title.length).toBeGreaterThan(3);
      expect(item.paragraphs.length + item.bullets.length).toBeGreaterThan(0);
    }
  });

  it("never emits duplicate section ids", () => {
    const ids = sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("report — patient information is factual", () => {
  it("records the age and sex that were entered", () => {
    const caseData = buildDemoCase("respiratory");
    const patient = section(makeInput(caseData), "patient_information");
    expect(patient?.bullets.join(" | ")).toContain("Age: 34");
    expect(patient?.bullets.join(" | ")).toContain("Sex: female");
  });

  it("says 'not provided' rather than leaving a gap", () => {
    // Absence must be explicit, so a reader can tell omission from a blank field.
    const patient = section(makeInput(buildEmptyCase()), "patient_information");
    expect(patient?.bullets.join(" | ")).toContain("Age: not provided");
    expect(patient?.bullets.join(" | ")).toContain("Sex: not provided");
  });

  it("labels a demo report unmistakably", () => {
    const patient = section(
      makeInput(buildDemoCase("respiratory"), { patientLabel: "DEMO PATIENT (synthetic data)" }),
      "patient_information",
    );
    expect(patient?.bullets.join(" | ")).toContain("DEMO PATIENT");
  });
});

describe("report — presenting symptoms restate user input", () => {
  it("lists the symptoms with their duration and severity", () => {
    const caseData = buildDemoCase("respiratory");
    const presenting = section(makeInput(caseData), "presenting_symptoms");
    const text = presenting?.bullets.join(" | ") ?? "";
    expect(text).toContain("Cough");
    expect(text).toContain("6 days");
    expect(text).toContain("Fever");
  });

  it("falls back to the free text when no symptoms were selected", () => {
    const caseData = buildEmptyCase();
    caseData.freeText = "I have had a cough since Tuesday and it is not improving.";
    const presenting = section(makeInput(caseData), "presenting_symptoms");
    expect(presenting?.bullets.join(" ")).toContain("cough since Tuesday");
  });

  it("does not invent symptoms for an empty case", () => {
    const presenting = section(makeInput(buildEmptyCase()), "presenting_symptoms");
    expect(presenting?.bullets).toHaveLength(0);
  });
});

describe("report — relevant history", () => {
  it("includes history, medications and allergies", () => {
    const caseData = buildDemoCase("respiratory");
    const history = section(makeInput(caseData), "relevant_history");
    const text = history?.bullets.join(" | ") ?? "";
    expect(text).toContain("allergic rhinitis");
    expect(text).toContain("Medications reported:");
    expect(text).toContain("Allergies reported:");
  });

  it("records follow-up answers verbatim", () => {
    const history = section(makeInput(buildDemoCase("respiratory")), "relevant_history");
    const text = history?.bullets.join(" | ") ?? "";
    expect(text).toContain("Follow-up answers given:");
    expect(text).toContain("Q: ");
  });

  it("states plainly that nothing was provided", () => {
    const history = section(makeInput(buildEmptyCase()), "relevant_history");
    expect(history?.bullets).toHaveLength(0);
    expect(history?.paragraphs.join(" ")).toMatch(/No medical history/i);
  });
});

describe("report — urgency provenance", () => {
  it("says when the safety rules raised urgency", () => {
    const escalated: TriageResult = { ...TRIAGE, escalated: true, level: "EMERGENCY" };
    const result: AssessmentResult = {
      ...RESULT,
      urgency: {
        level: "EMERGENCY",
        reason: "…",
        overriddenBySafetyRules: true,
        aiSuggestedLevel: "ROUTINE",
      },
    };
    const urgency = section(makeInput(buildEmptyCase(), { triage: escalated, result }), "urgency");
    const text = urgency?.paragraphs.join(" ") ?? "";
    expect(text).toMatch(/deterministic safety rules/i);
    expect(urgency?.emphasis).toBe("critical");
  });

  it("lists the rules that fired", () => {
    const urgency = section(makeInput(buildDemoCase("respiratory")), "urgency");
    expect(urgency?.paragraphs.join(" ")).toContain("fever_present");
  });
});

describe("report — limitations and disclaimer are unconditional", () => {
  it("always renders the limitations section even when the model returned none", () => {
    const result: AssessmentResult = { ...RESULT, limitations: [] };
    const limitations = section(makeInput(buildEmptyCase(), { result }), "limitations");
    expect(limitations).toBeDefined();
    expect(limitations?.paragraphs.join(" ")).toMatch(/apply to every MedAssist AI output/i);
  });

  it("surfaces the model-supplied limitations as bullets", () => {
    const limitations = section(makeInput(buildEmptyCase()), "limitations");
    expect(limitations?.bullets).toContain("No examination was performed.");
  });

  it("carries the full disclaimer on every document", () => {
    const document_ = buildReportDocument(makeInput(buildDemoCase("lab-review")));
    expect(document_.disclaimer).toBe(REPORT_DISCLAIMER);
    expect(document_.disclaimer).toMatch(/NOT a diagnosis/i);
    expect(document_.disclaimer).toMatch(/emergency/i);
  });
});

describe("report — provenance", () => {
  it("records model, prompt version, ruleset version and assessment id", () => {
    const provenance = section(makeInput(buildEmptyCase()), "provenance");
    const text = provenance?.bullets.join(" | ") ?? "";
    expect(text).toContain("abc123");
    expect(text).toContain("test-model");
    expect(text).toContain("2026.06.01");
  });
});

describe("report — document generation", () => {
  it("produces a titled document with a timestamp", () => {
    const document_ = buildReportDocument(makeInput(buildDemoCase("respiratory")));
    expect(document_.title.length).toBeGreaterThan(3);
    expect(document_.subtitle.length).toBeGreaterThan(3);
    expect(Date.parse(document_.generatedAt)).not.toBeNaN();
  });

  it("is a pure function of its input", () => {
    const input = makeInput(buildDemoCase("lab-review"));
    const first = buildReportDocument(input);
    const second = buildReportDocument(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("serialises to JSON without losing sections", () => {
    const document_ = buildReportDocument(makeInput(buildDemoCase("respiratory")));
    const parsed = JSON.parse(JSON.stringify(document_)) as { sections: unknown[] };
    expect(parsed.sections).toHaveLength(document_.sections.length);
  });
});