import type { AssessmentStage, AssessmentStatus } from "@/types/assessment";

/** The six visible positions in the assessment wizard. */
export type AssessmentWorkflowStep = 0 | 1 | 2 | 3 | 4 | 5;

/** Persisted lifecycle stage for each wizard position. */
export const ASSESSMENT_STEP_STAGES: readonly AssessmentStage[] = [
  "information",
  "symptoms",
  "questions",
  "documents",
  "analysis",
  "assessment",
];

/**
 * Drafts save their last completed stage. Resume at the following actionable
 * step, except for analysis states, which are safe to restart after a reload.
 */
export function resumeStepForAssessment(input: {
  status: AssessmentStatus;
  stage: string;
}): AssessmentWorkflowStep {
  if (input.status === "complete") return 5;
  if (input.status === "analyzing" || input.status === "failed") return 4;

  switch (input.stage.trim().toLowerCase()) {
    case "information":
      return 1;
    case "symptoms":
      return 2;
    case "questions":
    case "documents":
      return 3;
    case "analysis":
      return 4;
    case "assessment":
      return 5;
    default:
      // Older records may not have a recognised stage. They were created only
      // after information was submitted, so symptoms is the safest restart.
      return 1;
  }
}

/** Whether a dashboard card should reopen the wizard instead of the read-only detail view. */
export function isAssessmentResumable(status: AssessmentStatus): boolean {
  return status !== "complete";
}
