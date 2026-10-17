"use client";

import * as React from "react";

import { api, errorMessage } from "@/lib/api/client";
import {
  createAssessment as createAssessmentRecord,
  getAssessment,
  getLatestAnalysis,
  listUploads as readUploads,
  updateAssessment as patchAssessment,
  writeAuditLog,
} from "@/lib/data";
import { ASSESSMENT_STEP_STAGES, resumeStepForAssessment } from "@/lib/assessment/workflow";
import { buildEmptyCase, summariseCase } from "@/lib/medical/empty-case";
import { buildDemoCase, DEMO_SCENARIOS, pendingDemoDocuments } from "@/lib/medical/demo-data";
import type { AssessmentResult, AuditMetadata, TriageResult } from "@/types/assessment";
import type { UploadRecord } from "@/types/firebase";
import type { DocumentKind, MedicalCase, MedicalDocument } from "@/types/medical";
import type { MedicalQuestion } from "@/types/ai-primitives";
import type { IntakeAnalysis } from "@/types/ai";
import { useAuth } from "@/components/auth/auth-provider";

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

export const STEP_LABELS = [
  "Information",
  "Symptoms",
  "Questions",
  "Documents",
  "Analysis",
  "Assessment",
] as const;

export type QuestionAnswer = string | string[] | number | boolean | null;

export interface AnswerMap {
  [questionId: string]: QuestionAnswer;
}

export interface UploadState {
  id: string;
  /**
   * The in-memory File, held only for the current browser session.
   *
   * Needed because the analysis stages re-read the bytes: vision analysis needs
   * the image, and re-extraction needs the PDF. It is never persisted and never
   * sent to Firestore. After a reload it is absent, and the UI says so rather
   * than pretending the image was analysed.
   */
  file?: File;
  fileName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  kind: DocumentKind;
  status: "pending" | "uploaded" | "analyzed" | "failed";
  previewUrl?: string | null;
  /** Present for synthetic demo documents. */
  extractedText?: string;
  analysis?: MedicalDocument["analysis"];
  imaging?: MedicalDocument["imaging"];
  extractionNotes?: string[];
  uploading?: boolean;
  error?: string | null;
}

export interface AnalysisStageState {
  id: string;
  label: string;
  detail: string;
  status: "idle" | "running" | "done" | "skipped" | "failed";
}

export interface WizardState {
  assessmentId: string | null;
  /** A draft was requested in the URL and is still being restored. */
  hydratingDraft: boolean;
  isDemo: boolean;
  demoScenarioId: string | null;
  caseData: MedicalCase;
  step: WizardStep;
  maxStepReached: WizardStep;

  intake: IntakeAnalysis | null;
  intakeAudit: AuditMetadata | null;

  questions: MedicalQuestion[];
  questionRationale: string;
  questionsSource: "model" | "fallback" | "pending";
  questionNotice: string | null;
  answers: AnswerMap;

  uploads: UploadState[];

  triage: TriageResult | null;
  result: AssessmentResult | null;
  assessmentAudit: AuditMetadata | null;
  rulesetVersion: string | null;

  stages: AnalysisStageState[];
  busy: boolean;
  error: string | null;
  retryable: boolean;
}

const INITIAL_STAGES: AnalysisStageState[] = [
  { id: "safety", label: "Checking safety rules", detail: "Scanning for time-critical warning signs", status: "idle" },
  { id: "intake", label: "Extracting symptoms", detail: "Organising what you described", status: "idle" },
  { id: "questions", label: "Choosing follow-up questions", detail: "Selecting the most useful questions", status: "idle" },
  { id: "documents", label: "Reading your documents", detail: "Transcribing values exactly as printed", status: "idle" },
  { id: "imaging", label: "Reviewing imaging information", detail: "Checking available image information", status: "idle" },
  { id: "assessment", label: "Generating the assessment", detail: "Preparing your report", status: "idle" },
];

function initialState(): WizardState {
  return {
    assessmentId: null,
    hydratingDraft: false,
    isDemo: false,
    demoScenarioId: null,
    caseData: buildEmptyCase(),
    step: 0,
    maxStepReached: 0,
    intake: null,
    intakeAudit: null,
    questions: [],
    questionRationale: "",
    questionsSource: "pending",
    questionNotice: null,
    answers: {},
    uploads: [],
    triage: null,
    result: null,
    assessmentAudit: null,
    rulesetVersion: null,
    stages: INITIAL_STAGES.map((stage) => ({ ...stage })),
    busy: false,
    error: null,
    retryable: false,
  };
}

interface Action {
  type: string;
  payload?: unknown;
}

function reducer(state: WizardState, action: Action): WizardState {
  const p = action.payload as never;

  switch (action.type) {
    case "reset":
      return initialState();

    case "hydrate":
      return { ...state, ...(p as Partial<WizardState>) };

    case "setStep": {
      const step = p as WizardStep;
      return {
        ...state,
        step,
        maxStepReached: (Math.max(state.maxStepReached, step) as number) as WizardStep,
        error: null,
      };
    }

    case "setBusy":
      return { ...state, busy: p as boolean, ...(p ? { error: null } : {}) };

    case "setError":
      return {
        ...state,
        error: typeof p === "string" ? p : (p as { message: string })?.message ?? "Something went wrong.",
        retryable: typeof p === "string" ? true : ((p as { retryable?: boolean })?.retryable ?? true),
        busy: false,
      };

    case "clearError":
      return { ...state, error: null };

    case "setCaseField": {
      const { field, value } = p as { field: keyof MedicalCase; value: unknown };
      return { ...state, caseData: { ...state.caseData, [field]: value } };
    }

    case "setDemographics": {
      const value = p as MedicalCase["demographics"];
      return { ...state, caseData: { ...state.caseData, demographics: { ...state.caseData.demographics, ...value } } };
    }

    case "setLifestyle": {
      const value = p as Partial<MedicalCase["lifestyle"]>;
      return {
        ...state,
        caseData: { ...state.caseData, lifestyle: { ...state.caseData.lifestyle, ...value } },
      };
    }

    case "setTriage":
      return { ...state, triage: p as TriageResult };

    case "setIntake": {
      const { intake, audit } = p as { intake: IntakeAnalysis; audit?: AuditMetadata };
      return { ...state, intake, intakeAudit: audit ?? state.intakeAudit };
    }

    case "setQuestions":
      return { ...state, ...(p as Partial<WizardState>) };

    case "setAnswer": {
      const { id, answer } = p as { id: string; answer: QuestionAnswer };
      const answers = { ...state.answers, [id]: answer };

      // Keep the case snapshot in step so the final assessment sees the answers.
      const caseAnswers = state.questions
        .filter((question) => question.id in answers)
        .map((question) => ({
          question: question.question,
          answer: formatAnswer(answers[question.id]),
          questionId: question.id,
        }));

      return { ...state, answers, caseData: { ...state.caseData, answers: caseAnswers } };
    }

    case "addUpload":
      return { ...state, uploads: [...state.uploads, p as UploadState] };

    case "patchUpload": {
      const { id, patch } = p as { id: string; patch: Partial<UploadState> };
      return {
        ...state,
        uploads: state.uploads.map((upload) =>
          upload.id === id ? { ...upload, ...patch } : upload,
        ),
      };
    }

    case "removeUpload":
      return {
        ...state,
        uploads: state.uploads.filter((upload) => upload.id !== (p as string)),
      };

    case "setStage": {
      const { id, status } = p as { id: string; status: AnalysisStageState["status"] };
      return {
        ...state,
        stages: state.stages.map((stage) => (stage.id === id ? { ...stage, status } : stage)),
      };
    }

    case "setStages":
      return { ...state, stages: p as AnalysisStageState[] };

    case "markRunningStagesFailed":
      return {
        ...state,
        stages: state.stages.map((stage) =>
          stage.status === "running" ? { ...stage, status: "failed" as const } : stage,
        ),
      };

    case "setResult":
      return { ...state, ...(p as Partial<WizardState>) };

    default:
      return state;
  }
}

function formatAnswer(value: QuestionAnswer | undefined): string {
  if (value === undefined || value === null || value === "") return "Not answered";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Projects the documents already present in a case snapshot into the wizard's
 * upload list.
 *
 * Demo scenarios carry synthetic documents with extracted text but no upload
 * record, because nothing was actually uploaded. Without this the documents
 * would be invisible in step 4 and would never reach the analysis pipeline.
 * They still go through the real document-analysis endpoint — there is no
 * shortcut and no hard-coded AI output.
 */
export function seedUploadsFromCase(caseData: MedicalCase): UploadState[] {
  return caseData.documents.map((document) => ({
    id: document.id,
    fileName: document.fileName,
    displayName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    kind: document.kind,
    status: document.uploadStatus,
    previewUrl: null,
    ...(document.extractedText ? { extractedText: document.extractedText } : {}),
    ...(document.analysis ? { analysis: document.analysis } : {}),
    ...(document.imaging ? { imaging: document.imaging } : {}),
    error: null,
  }));
}

/** Converts persisted upload metadata into the state used by the wizard UI. */
function uploadStateFromRecord(record: UploadRecord, existing?: UploadState): UploadState {
  const extractedText = record.extractedText ?? existing?.extractedText;
  const analysis = record.analysis ?? existing?.analysis;
  const imaging = record.imaging ?? existing?.imaging;

  return {
    ...(existing?.file ? { file: existing.file } : {}),
    id: record.id,
    fileName: record.fileName,
    displayName: record.displayName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    kind: record.kind,
    status: record.status,
    previewUrl: existing?.previewUrl ?? (record.mimeType.startsWith("image/") ? null : undefined),
    ...(extractedText ? { extractedText } : {}),
    ...(analysis ? { analysis } : {}),
    ...(imaging ? { imaging } : {}),
    ...(existing?.extractionNotes ? { extractionNotes: existing.extractionNotes } : {}),
    error:
      existing?.error ??
      (record.errorCode ? "This upload could not be processed. You can remove it or upload it again." : null),
  };
}

/**
 * Merges the case snapshot, live wizard files and upload records. Firestore
 * upload metadata is the source of truth after a refresh; local state keeps
 * the in-memory File that is needed for image analysis in the current session.
 */
function mergeUploads(
  caseData: MedicalCase,
  persisted: UploadRecord[],
  current: UploadState[] = [],
): UploadState[] {
  const byId = new Map<string, UploadState>();

  for (const upload of seedUploadsFromCase(caseData)) byId.set(upload.id, upload);
  for (const upload of current) {
    byId.set(upload.id, { ...byId.get(upload.id), ...upload });
  }
  for (const upload of persisted) {
    byId.set(upload.id, uploadStateFromRecord(upload, byId.get(upload.id)));
  }

  return [...byId.values()];
}

function documentsFromUploads(uploads: UploadState[]): MedicalDocument[] {
  return uploads.map((upload) => ({
    id: upload.id,
    kind: upload.kind,
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
    ...(upload.extractedText ? { extractedText: upload.extractedText } : {}),
    ...(upload.analysis ? { analysis: upload.analysis } : {}),
    ...(upload.imaging ? { imaging: upload.imaging } : {}),
    uploadStatus: upload.status,
  }));
}

const WizardContext = React.createContext<{
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  /** Persists the case snapshot + answers to the server. */
  save: (caseData?: MedicalCase, step?: WizardStep) => Promise<void>;
  createAssessment: (options?: { demo?: boolean; scenarioId?: string; caseData?: MedicalCase }) => Promise<string>;
  runSafetyCheck: (caseData?: MedicalCase) => Promise<void>;
  refreshUploads: () => Promise<void>;
} | null>(null);

export function WizardProvider({
  children,
  initialAssessmentId,
}: {
  children: React.ReactNode;
  initialAssessmentId?: string;
}) {
  const [state, dispatch] = React.useReducer(reducer, {
    ...initialState(),
    assessmentId: initialAssessmentId ?? null,
    hydratingDraft: Boolean(initialAssessmentId),
  });

  const { user, ready } = useAuth();
  const uid = user?.uid ?? null;
  const creatingRef = React.useRef<Promise<string> | null>(null);

  const save = React.useCallback(async (caseData = state.caseData, step = state.step) => {
    const id = state.assessmentId;
    if (!id || !uid) {
      const message = !uid
        ? ready
          ? "Please sign in before continuing your assessment."
          : "Your sign-in is still loading. Please wait a moment and try again."
        : "Your assessment is still being created. Please try again in a moment.";
      dispatch({ type: "setError", payload: { message, retryable: true } });
      throw new Error(message);
    }

    try {
      await patchAssessment(uid, id, {
        caseData,
        stage: ASSESSMENT_STEP_STAGES[step],
        status: "in_progress",
      });
    } catch (error) {
      const message = errorMessage(error);
      dispatch({ type: "setError", payload: { message: `Your draft could not be saved: ${message}`, retryable: true } });
      throw error;
    }
  }, [ready, uid, state.assessmentId, state.caseData, state.step]);

  const createAssessment = React.useCallback(
    async (options: { demo?: boolean; scenarioId?: string; caseData?: MedicalCase } = {}) => {
      if (state.assessmentId) return state.assessmentId;
      if (creatingRef.current) return creatingRef.current;

      if (!uid) {
        const message = ready
          ? "Please sign in before starting an assessment."
          : "Your sign-in is still loading. Please wait a moment and try again.";
        dispatch({ type: "setError", payload: { message, retryable: true } });
        throw new Error(message);
      }

      const operation = (async () => {
        const isDemo = options.demo === true;
        const scenarioId = options.scenarioId ?? "respiratory";
        const caseData = options.caseData ?? (isDemo ? buildDemoCase(scenarioId) : buildEmptyCase());

        try {
          // Straight to Firestore through the client SDK. The rules prove ownership
          // from the signed-in uid; there is no server in this path.
          const created = await createAssessmentRecord({
            title: isDemo ? "Demo — Synthetic data" : "New assessment",
            symptomSummary: isDemo ? "Synthetic demo scenario" : "Not yet described",
            isDemo,
            caseData,
          });

          void writeAuditLog({
            action: "assessment_created",
            resourceType: "assessment",
            resourceId: created.id,
            metadata: { isDemo },
          });

          dispatch({
            type: "hydrate",
            payload: {
              assessmentId: created.id,
              hydratingDraft: false,
              caseData,
              ...(isDemo ? { uploads: seedUploadsFromCase(caseData) } : {}),
              isDemo,
              ...(isDemo ? { demoScenarioId: scenarioId } : {}),
              ...(isDemo ? { step: 1 as WizardStep, maxStepReached: 1 as WizardStep } : {}),
            },
          });

          return created.id;
        } catch (error) {
          dispatch({
            type: "setError",
            payload: {
              message: `Your assessment could not be created: ${errorMessage(error)}`,
              retryable: true,
            },
          });
          throw error;
        }
      })();
      creatingRef.current = operation;
      try { return await operation; } finally { creatingRef.current = null; }
    },
    [ready, state.assessmentId, uid],
  );

  React.useEffect(() => {
    const draftId = initialAssessmentId?.trim();
    if (!draftId) return;
    let cancelled = false;
    if (!uid) {
      if (ready) {
        dispatch({
          type: "hydrate",
          payload: {
            assessmentId: null,
            hydratingDraft: false,
            error: "Please sign in to resume this assessment.",
            retryable: true,
          },
        });
      }
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const record = await getAssessment(uid, draftId);
        if (cancelled) return;
        if (!record) {
          dispatch({
            type: "hydrate",
            payload: {
              assessmentId: null,
              hydratingDraft: false,
              error: "This draft could not be found.",
              retryable: false,
            },
          });
          return;
        }

        if (record.status === "complete") {
          const analysis = await getLatestAnalysis(uid, record.id);
          if (cancelled) return;
          if (!analysis) throw new Error("The completed assessment result could not be found.");

          dispatch({
            type: "hydrate",
            payload: {
              assessmentId: record.id,
              hydratingDraft: false,
              caseData: analysis.caseData,
              uploads: seedUploadsFromCase(analysis.caseData),
              isDemo: record.isDemo,
              intakeAudit: analysis.audit.intake ?? null,
              assessmentAudit: analysis.audit.assessment ?? null,
              triage: analysis.triage,
              result: analysis.result,
              step: 5 as WizardStep,
              maxStepReached: 5 as WizardStep,
              busy: false,
              error: null,
            },
          });
          return;
        }

        const persistedUploads = await readUploads(uid, record.id);
        if (cancelled) return;
        const uploads = mergeUploads(record.caseData, persistedUploads);
        const step = resumeStepForAssessment(record);
        const caseData = { ...record.caseData, documents: documentsFromUploads(uploads) };

        dispatch({
          type: "hydrate",
          payload: {
            assessmentId: record.id,
            hydratingDraft: false,
            caseData,
            uploads,
            isDemo: record.isDemo,
            step,
            maxStepReached: step,
            busy: false,
            error: null,
          },
        });
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "hydrate",
            payload: {
              assessmentId: null,
              hydratingDraft: false,
              error: `Draft loading failed: ${errorMessage(error)}`,
              retryable: true,
            },
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [initialAssessmentId, ready, uid]);

  const runSafetyCheck = React.useCallback(async (caseData = state.caseData) => {
    try {
      const response = await api.put<{ triage: TriageResult }>("/api/ai/intake", {
        symptoms: caseData.symptoms.map((s) => s.name),
        answers: caseData.answers,
        freeText: caseData.freeText,
        age: caseData.demographics.age,
      });
      dispatch({ type: "setTriage", payload: response.triage });
    } catch (error) {
      console.warn("[wizard] safety check failed:", errorMessage(error));
    }
  }, [state.caseData]);

  const refreshUploads = React.useCallback(async () => {
    const id = state.assessmentId;
    if (!id || !uid) return;

    try {
      const uploads = mergeUploads(state.caseData, await readUploads(uid, id), state.uploads);
      dispatch({
        type: "hydrate",
        payload: {
          uploads,
          caseData: { ...state.caseData, documents: documentsFromUploads(uploads) },
        },
      });
    } catch (error) {
      console.warn("[wizard] upload refresh failed:", errorMessage(error));
    }
  }, [state.assessmentId, state.caseData, state.uploads, uid]);

  const value = React.useMemo(
    () => ({ state, dispatch, save, createAssessment, runSafetyCheck, refreshUploads }),
    [state, save, createAssessment, runSafetyCheck, refreshUploads],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const context = React.useContext(WizardContext);
  if (!context) throw new Error("useWizard must be used inside <WizardProvider>.");
  return context;
}

/** Documents that still need analysis before the final assessment. */
export function documentsNeedingAnalysis(state: WizardState) {
  return state.uploads.filter(
    (upload) => upload.status !== "analyzed" && Boolean(upload.extractedText),
  );
}

/** Builds the case snapshot sent to the final assessment. */
export function buildAssessmentCase(state: WizardState): MedicalCase {
  return {
    ...state.caseData,
    documents: documentsFromUploads(state.uploads),
    freeText: state.caseData.freeText,
  };
}

export { summariseCase, DEMO_SCENARIOS, pendingDemoDocuments };
