/**
 * Domain types shared by the medical reasoning pipeline.
 *
 * Everything in this file is plain data. No medical logic lives in types.
 */

/** Urgency ladder. Ordered from least to most time-critical. */
export const URGENCY_LEVELS = [
  "ROUTINE",
  "NON_URGENT",
  "PROMPT_MEDICAL_REVIEW",
  "URGENT",
  "EMERGENCY",
] as const;

export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export function urgencyRank(level: UrgencyLevel): number {
  const index = URGENCY_LEVELS.indexOf(level);
  return index === -1 ? 0 : index;
}

export type Sex = "female" | "male" | "intersex" | "prefer_not_to_say" | "";

export interface Demographics {
  age?: number;
  sex?: Sex;
}

export interface CaseSymptom {
  name: string;
  duration?: string;
  severity?: string;
  /** Marks whether the AI extracted this from prose or the user picked it. */
  source: "user_selected" | "ai_extracted" | "ai_suggested";
}

export interface CaseAnswer {
  question: string;
  answer: string;
  /** Which stage produced the question, useful for the audit trail. */
  questionId?: string;
}

export interface MedicalHistoryEntry {
  condition: string;
  status: "active" | "past" | "family" | "surgical" | "";
  note?: string;
}

export type DocumentKind =
  | "blood_test"
  | "radiology_report"
  | "pathology_report"
  | "prescription"
  | "discharge_summary"
  | "imaging_image"
  | "other"
  | "unknown";

export type FindingStatus =
  | "within_reference_range"
  | "below_reference_range"
  | "above_reference_range"
  | "abnormal_flagged_by_report"
  | "indeterminate"
  | "not_stated";

export interface DocumentFinding {
  test: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  status: FindingStatus;
  /** Verbatim snippet from the source document that supports this finding. */
  evidence?: string;
  note?: string;
}

export interface DocumentAnalysis {
  documentType: DocumentKind;
  title?: string;
  findings: DocumentFinding[];
  /** Written impression, only when the document itself contains one. */
  impression?: string;
  /** Recommendations that the *original report* gave — never AI-generated. */
  reportRecommendations: string[];
  warnings: string[];
  /** How much text we actually managed to extract. */
  extraction: {
    characters: number;
    pages: number;
    /** true when the PDF had a text layer we could read. */
    textLayerFound: boolean;
  };
  truncated: boolean;
}

export interface ImagingObservation {
  observation: string;
  /** Plain-language uncertainty statement. Never a numeric confidence. */
  uncertainty: "low" | "moderate" | "high";
  evidence: string;
  limitations: string[];
}

export interface ImagingAnalysis {
  /** Explicit provenance so the UI can never blur the two sources. */
  mode: "model_vision" | "report_text_only" | "unavailable";
  analyzedBy?: string;
  observations: ImagingObservation[];
  limitations: string[];
  /** Present when mode !== "model_vision". */
  unavailableReason?: string;
}

export interface MedicalDocument {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Storage path, never a public URL. */
  storagePath?: string;
  /**
   * Source text, when it exists in the case snapshot.
   *
   * Present for documents whose text was extracted server-side, and for the
   * synthetic text used by demo mode so the real analysis pipeline runs
   * unchanged. Never used to bypass validation.
   */
  extractedText?: string;
  analysis?: DocumentAnalysis;
  imaging?: ImagingAnalysis;
  uploadStatus: "pending" | "uploaded" | "analyzed" | "failed";
}

export interface MedicalCase {
  demographics: Demographics;
  symptoms: CaseSymptom[];
  answers: CaseAnswer[];
  medicalHistory: MedicalHistoryEntry[];
  medications: string[];
  allergies: string[];
  lifestyle: {
    smoking?: string;
    alcohol?: string;
    pregnancy?: string;
    recentTravel?: string;
    occupationalExposure?: string;
  };
  documents: MedicalDocument[];
  /** Free-text the user typed. Treated as untrusted input. */
  freeText: string;
}

/**
 * Categories of evidence, surfaced in the UI so the user can see exactly which
 * information shaped the output.
 */
export const EVIDENCE_CATEGORIES = [
  "user_provided",
  "extracted_from_document",
  "ai_generated_interpretation",
  "possible_explanation",
  "risk_urgency_assessment",
  "recommended_next_step",
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export interface EvidenceItem {
  category: EvidenceCategory;
  label: string;
  detail: string;
}