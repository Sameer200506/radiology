import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_STEP_STAGES,
  isAssessmentResumable,
  resumeStepForAssessment,
} from "@/lib/assessment/workflow";

describe("assessment workflow lifecycle", () => {
  it("uses lowercase persisted stages for every wizard step", () => {
    expect(ASSESSMENT_STEP_STAGES).toEqual([
      "information",
      "symptoms",
      "questions",
      "documents",
      "analysis",
      "assessment",
    ]);
  });

  it.each([
    ["information", 1],
    ["Symptoms", 2],
    ["questions", 3],
    ["documents", 3],
    ["analysis", 4],
  ] as const)("resumes a saved %s stage at step %i", (stage, expectedStep) => {
    expect(resumeStepForAssessment({ status: "in_progress", stage })).toBe(expectedStep);
  });

  it("restarts interrupted or failed analysis and keeps completed work read-only", () => {
    expect(resumeStepForAssessment({ status: "analyzing", stage: "documents" })).toBe(4);
    expect(resumeStepForAssessment({ status: "failed", stage: "analysis" })).toBe(4);
    expect(resumeStepForAssessment({ status: "complete", stage: "assessment" })).toBe(5);
  });

  it("routes every non-complete assessment back to the wizard", () => {
    expect(isAssessmentResumable("draft")).toBe(true);
    expect(isAssessmentResumable("in_progress")).toBe(true);
    expect(isAssessmentResumable("analyzing")).toBe(true);
    expect(isAssessmentResumable("failed")).toBe(true);
    expect(isAssessmentResumable("complete")).toBe(false);
  });
});
