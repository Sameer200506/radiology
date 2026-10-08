import type { UrgencyLevel } from "@/types/medical";
import type { GuardedCase } from "@/lib/api/guarded-case";

/** Lifecycle of an assessment document in Firestore. */
export const ASSESSMENT_STATUSES = [
  "draft",
  "in_progress",
  "analyzing",
  "complete",
  "failed",
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_STAGES = [
  "information",
  "symptoms",
  "questions",
  "documents",
  "analysis",
  "assessment",
] as const;

export type AssessmentStage = (typeof ASSESSMENT_STAGES)[number];

export interface KeyFinding {
  title: string;
  detail: string;
  /** Which information source produced this finding. */
  source: "symptoms" | "answers" | "document" | "imaging" | "demographics" | "history";
}

export interface SymptomAnalysisItem {
  symptom: string;
  interpretation: string;
  severityNote?: string;
  durationNote?: string;
}

export interface PossibleExplanation {
  rank: number;
  explanation: string;
  whyItMayFit: string[];
  /** What would confirm or rule this out. */
  whatWouldTestIt: string[];
  /** Plain-language statement that this is not a diagnosis. */
  confidenceNote: string;
}

export interface RedFlagFinding {
  flag: string;
  why: string;
  source: "deterministic_rule" | "ai_identified" | "user_stated";
  /** Only deterministic rules can escalate urgency on their own. */
  severity: "escalate" | "urgent_review" | "monitor";
}

export interface RecommendedNextStep {
  step: string;
  timeframe: "immediately" | "within_24_hours" | "within_48_hours" | "within_1_week" | "routine_follow_up";
  category: "seek_emergency_care" | "seek_urgent_care" | "book_clinician" | "self_care" | "monitor" | "information_gathering";
  /**
   * Optional. A model may return a bare instruction with no justification, in
   * which case none is written rather than one being invented.
   */
  rationale?: string;
}

export interface AssessmentResult {
  summary: string;
  keyFindings: KeyFinding[];
  symptomAnalysis: SymptomAnalysisItem[];
  documentFindings: string[];
  imagingObservations: string[];
  possibleExplanations: PossibleExplanation[];
  redFlags: RedFlagFinding[];
  urgency: {
    level: UrgencyLevel;
    reason: string;
    /** True when the deterministic layer overrode a lower AI suggestion. */
    overriddenBySafetyRules: boolean;
    aiSuggestedLevel: UrgencyLevel | null;
  };
  recommendedNextSteps: RecommendedNextStep[];
  questionsForClinician: string[];
  limitations: string[];
  /** Which categories of input actually informed the result. */
  evidenceUsed: string[];
  /** Which categories had no data at all. */
  missingInformation: string[];
}

/** What the deterministic safety layer produced, independent of the LLM. */
export interface TriageResult {
  level: UrgencyLevel;
  escalated: boolean;
  redFlags: RedFlagFinding[];
  emergencyNotice: string | null;
  /** Human-readable rule identifiers that fired — shown in the UI for transparency. */
  firedRules: string[];
  notes: string[];
}

export interface AuditMetadata {
  model: string;
  modelProvider?: string;
  promptVersion: string;
  stage: string;
  startedAt: string;
  completedAt: string;
  inputCategories: string[];
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  usedFallback: boolean;
  repairAttempted: boolean;
}

export interface StoredAnalysis {
  id: string;
  assessmentId: string;
  createdAt: string;
  triage: TriageResult;
  result: AssessmentResult;
  /**
   * The exact case snapshot the analysis was produced from.
   *
   * The report is rendered deterministically from this, so it must be stored
   * with the analysis rather than read back from a possibly-edited assessment.
   */
  caseData: GuardedCase;
  audit: {
    intake?: AuditMetadata;
    questions?: AuditMetadata;
    assessment?: AuditMetadata;
    documents?: AuditMetadata[];
    imaging?: AuditMetadata[];
  };
}

/** Compact card model used by dashboard lists — never loads full results. */
export interface AssessmentSummary {
  id: string;
  title: string;
  symptomSummary: string;
  status: AssessmentStatus;
  urgency: UrgencyLevel | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  /** Never used for clinical decisions — convenience only. */
  defaultAge: number | null;
  defaultSex: string | null;
  settings: UserSettings;
  isDemo: boolean;
}

export interface UserSettings {
  theme: "system" | "light" | "dark";
  reducedMotion: boolean;
  analyticsOptIn: boolean;
  disclaimerAcknowledgedAt: string | null;
}

export interface ReportRecord {
  id: string;
  assessmentId: string;
  title: string;
  createdAt: string;
/** Share token; share links are read-only and explicit opt-in. */
  shareId: string | null;
  shareEnabled: boolean;
  /**
   * The analysis snapshot copied here when sharing is enabled.
   *
   * The shared reader is signed out, and the rules keep
   * `assessments/**\/analysis` owner-only, so the report document carries its own
   * frozen copy. Set to null whenever sharing is turned off.
   */
  sharedAnalysis?: StoredAnalysis | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: AuditAction;
  resourceType: "assessment" | "upload" | "report" | "auth" | "session";
  resourceId: string | null;
  at: string;
  /** Deliberately coarse — no clinical content, no raw prompts. */
  metadata: Record<string, string | number | boolean | null>;
}

export const AUDIT_ACTIONS = [
  "assessment_created",
  "assessment_updated",
  "assessment_deleted",
  "analysis_started",
  "analysis_completed",
  "analysis_failed",
  "upload_created",
  "upload_deleted",
  "report_generated",
  "report_shared",
  "share_revoked",
  "auth_sign_in",
  "auth_sign_out",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];