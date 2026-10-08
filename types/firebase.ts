import type { AssessmentStatus } from "@/types/assessment";
import type {
  DocumentKind,
  FindingStatus,
  ImagingAnalysis,
  MedicalCase,
  MedicalDocument,
  UrgencyLevel,
} from "@/types/medical";

/** Minimal shape the browser needs in order to talk to Firestore. */
/** The publishable Firebase web config variables, all `NEXT_PUBLIC_*`. */
export type FirebaseEnvKey =
  | "NEXT_PUBLIC_FIREBASE_API_KEY"
  | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  | "NEXT_PUBLIC_FIREBASE_APP_ID";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface FirebaseClientEnv {
  config: FirebaseClientConfig | null;
  /** True when NEXT_PUBLIC_FIREBASE_* are present and complete. */
  configured: boolean;
  /** Missing variable names, for a friendly setup screen instead of a crash. */
  missing: FirebaseEnvKey[];
}

/** Upload metadata written to Firestore and mirrored by Storage rules. */
export interface UploadRecord {
  id: string;
  userId: string;
  assessmentId: string;
  fileName: string;
  /** Sanitised, non-identifying display name shown in the UI. */
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  kind: DocumentKind;
  storagePath: string;
  status: "pending" | "uploaded" | "analyzed" | "failed";
  textExtracted: boolean;
  characterCount: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  /**
   * Deterministic transcription of a document, written after the server
   * validated the model output. Absent until analysed.
   */
  analysis?: MedicalDocument["analysis"];
  /** Vision description of an image upload. */
  imaging?: ImagingAnalysis;
  /** Extracted text layer, held client-side only unless persisted deliberately. */
  extractedText?: string;
}

/** Server-side presigned upload contract. */
export interface PresignRequest {
  assessmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind?: DocumentKind;
}

export interface PresignResponse {
  uploadId: string;
  /** Namespaced path; the client can only ever write inside its own prefix. */
  storagePath: string;
  downloadUrl: string;
  expiresAt: string;
  maxBytes: number;
  /** Echoed back so the client can assert integrity after upload. */
  contentHash: string;
  headers: Record<string, string>;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiListQuery {
  limit?: number;
  cursor?: string;
  status?: AssessmentStatus;
  urgency?: UrgencyLevel;
}

/** Firestore document shapes (server-side; not sent to the browser verbatim). */
export interface UserDoc extends FirebaseClientConfigFreeProfile {
  [key: string]: unknown;
}

type FirebaseClientConfigFreeProfile = {
  displayName: string;
  email: string;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  defaultAge: number | null;
  defaultSex: string | null;
  isDemo: boolean;
  settings: {
    theme: string;
    reducedMotion: boolean;
    analyticsOptIn: boolean;
    disclaimerAcknowledgedAt: string | null;
  };
};

/** Persisted assessment shell (without the heavy analysis payload). */
export interface AssessmentDoc {
  id: string;
  userId: string;
  title: string;
  symptomSummary: string;
  status: AssessmentStatus;
  stage: string;
  urgency: UrgencyLevel | null;
  fileCount: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  /** Full case snapshot, stored under the assessment for reproducibility. */
  caseData: MedicalCase;
}

export interface FindingSummary {
  test: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  status: FindingStatus;
  note?: string;
}

export interface ImagingRecord {
  mode: ImagingAnalysis["mode"];
  observationCount: number;
  limitations: string[];
}