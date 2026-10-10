"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import {
  buildAssessmentCase,
  useWizard,
  type AnalysisStageState,
} from "@/components/assessment/wizard-store";
import { useAuth } from "@/components/auth/auth-provider";
import { api, errorMessage, isRetryable } from "@/lib/api/client";
import {
  saveAnalysis as persistAnalysis,
  updateAssessment as patchAssessment,
  updateUpload,
  listUploads,
  writeAuditLog,
} from "@/lib/data";
import { readFileAsDataUrl } from "@/lib/medical/extract-text-client";
import type { AssessmentResult, AuditMetadata, TriageResult } from "@/types/assessment";
import type { ImagingAnalysis } from "@/types/medical";
import { commitAnalysisUpload, hasSuccessfulImaging } from "./analysis-uploads";

/**
 * Step 5 — the analysis experience.
 *
 * The stages below are REAL. Each completes when its work finishes:
 *
 *   safety     → PUT /api/ai/intake        (deterministic only, no model call)
 *   intake     → POST /api/ai/intake
 *   questions  → POST /api/ai/questions
 *   documents  → POST /api/ai/document-analysis, once per document with text
 *   imaging    → POST /api/ai/image-analysis, once per image
 *   assessment → POST /api/ai/assessment
 *
 * There is no artificial delay, so the progress list moves as fast as the work
 * actually does.
 */
export function StepAnalysis() {
  const { state, dispatch } = useWizard();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [running, setRunning] = React.useState(false);
  const startedRef = React.useRef(false);
  const runningRef = React.useRef(false);

  const setStage = React.useCallback(
    (id: string, status: AnalysisStageState["status"]) => {
      dispatch({ type: "setStage", payload: { id, status } });
    },
    [dispatch],
  );

  const runAnalysis = React.useCallback(async () => {
    if (runningRef.current || state.result || !uid || !state.assessmentId) return;
    runningRef.current = true;
    setRunning(true);
    dispatch({ type: "setBusy", payload: true });
    dispatch({ type: "setStages", payload: state.stages.map((stage) => ({ ...stage, status: "idle" })) });
    dispatch({ type: "clearError" });

    const audit: {
      intake?: AuditMetadata;
      questions?: AuditMetadata;
      assessment?: AuditMetadata;
      documents?: AuditMetadata[];
      imaging?: AuditMetadata[];
    } = {};

    try {
      const assessmentId = state.assessmentId;
      const currentUploads = state.uploads;

      // Patches applied to uploads during this run. Kept alongside the dispatch
      // calls because `state` cannot be re-read mid-run.
      const uploadPatches = new Map<string, Partial<typeof state.uploads[number]>>();

      const patchUpload = (
        id: string,
        patch: Partial<typeof state.uploads[number]>,
      ) => {
        uploadPatches.set(id, { ...uploadPatches.get(id), ...patch });
        dispatch({ type: "patchUpload", payload: { id, patch } });
      };

      /* ---------------------------------------------- 1. Safety (no model) --- */
      setStage("safety", "running");
      const safety = await api.put<{ triage: TriageResult }>("/api/ai/intake", {
        symptoms: state.caseData.symptoms.map((s) => s.name),
        answers: state.caseData.answers,
        freeText: state.caseData.freeText,
        age: state.caseData.demographics.age,
      });
      dispatch({ type: "setTriage", payload: safety.triage });
      setStage("safety", "done");

      /* ------------------------------------------------------ 2. Intake --- */
      setStage("intake", "running");
      const intake = await api.post<{
        intake: import("@/types/ai").IntakeAnalysis;
        triage: TriageResult;
        audit: AuditMetadata;
      }>("/api/ai/intake", {
        freeText: state.caseData.freeText,
        selectedSymptoms: state.caseData.symptoms.map((s) => s.name),
        age: state.caseData.demographics.age,
        sex: state.caseData.demographics.sex || undefined,
        medicalHistory: state.caseData.medicalHistory.map((h) => h.condition),
        medications: state.caseData.medications,
        allergies: state.caseData.allergies,
      });
      dispatch({ type: "setIntake", payload: { intake: intake.intake, audit: intake.audit } });
      dispatch({ type: "setTriage", payload: intake.triage });
      audit.intake = intake.audit;
      setStage("intake", "done");

      /* ---------------------------------------------------- 3. Questions --- */
      if (state.questions.length === 0) {
        setStage("questions", "running");
        try {
          const questions = await api.post<{
            questions: { questions: import("@/types/ai-primitives").MedicalQuestion[]; rationale: string };
            source: "model" | "fallback";
            notice?: string;
            audit?: AuditMetadata;
          }>("/api/ai/questions", {
            freeText: state.caseData.freeText,
            age: state.caseData.demographics.age,
            sex: state.caseData.demographics.sex || undefined,
            symptoms: state.caseData.symptoms.map((s) => s.name),
            intake: intake.intake,
          });

          dispatch({
            type: "setQuestions",
            payload: {
              questions: questions.questions.questions,
              questionRationale: questions.questions.rationale,
              questionsSource: questions.source,
              questionNotice: questions.notice ?? null,
            },
          });
          if (questions.audit) audit.questions = questions.audit;
          setStage("questions", "done");
        } catch {
          // Questions are optional at this point; the assessment can still run.
          setStage("questions", "failed");
        }
      } else {
        setStage("questions", "skipped");
      }

      /* ---------------------------------------------------- 4. Documents --- */
      setStage("documents", "running");
      // Synthetic case documents have no upload record. Never create partial
      // metadata records for them (including in a demo with real uploads).
      const storedIds = new Set((await listUploads(uid, assessmentId)).map((upload) => upload.id));
      const commitUpload = (id: string, patch: Partial<typeof state.uploads[number]>) =>
        commitAnalysisUpload(id, patch, storedIds,
          (uploadId, metadata) => updateUpload(uid, assessmentId, uploadId, metadata), patchUpload);
      const pendingDocs = currentUploads.filter(
        (upload) => !upload.analysis && Boolean(upload.extractedText),
      );

      if (currentUploads.length === 0 || pendingDocs.length === 0) {
        setStage("documents", "skipped");
      } else {
        setStage("documents", "running");
        audit.documents = [];
        let documentsFailed = false;
        for (const document of pendingDocs) {
          try {
            const response = await api.post<{
              analysis: import("@/types/medical").MedicalDocument["analysis"];
              audit: AuditMetadata;
            }>("/api/ai/document-analysis", {
              extractedText: document.extractedText,
              fileName: document.fileName,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes,
            });
            await commitUpload(document.id, { analysis: response.analysis, status: "analyzed" });
            patchUpload(document.id, { error: null });
            audit.documents.push(response.audit);
          } catch {
            documentsFailed = true;
            patchUpload(document.id, { error: "This document could not be analysed." });
          }
        }
        setStage("documents", documentsFailed ? "failed" : "done");
      }

      /* ------------------------------------------------------ 5. Imaging --- */
      const images = currentUploads.filter((upload) => upload.mimeType.startsWith("image/"));
      if (images.length === 0) {
        setStage("imaging", "skipped");
      } else {
        setStage("imaging", "running");
        audit.imaging = [];
        let imagingFailed = false;
        for (const image of images) {
          if (hasSuccessfulImaging(image)) continue;
          try {
            const dataUrl = image.file
              ? await readFileAsDataUrl(image.file).catch(() => null)
              : null;

            // The browser does not retain the File after a reload, so an image
            // from an earlier session cannot be re-read. Report that honestly
            // rather than sending an empty payload.
            if (!dataUrl) {
              const unavailable: ImagingAnalysis = {
                mode: "unavailable",
                observations: [],
                limitations: [],
                unavailableReason:
                  "This image was uploaded in an earlier session, so its contents are no longer available for analysis. Re-upload it to have it described.",
              };
               await commitUpload(image.id, { imaging: unavailable, status: image.analysis ? "analyzed" : "uploaded" });
               imagingFailed = true;
               continue;
            }

            const response = await api.post<{
              imaging: ImagingAnalysis;
              audit?: AuditMetadata;
            }>("/api/ai/image-analysis", {
              imageDataUrl: dataUrl,
              fileName: image.fileName,
            });

            await commitUpload(image.id, {
              imaging: response.imaging,
              status: response.imaging.mode === "unavailable" ? "uploaded" : "analyzed",
            });
            patchUpload(image.id, { error: null });
            if (response.imaging.mode === "unavailable") imagingFailed = true;

            if (response.audit) audit.imaging.push(response.audit);
          } catch {
            imagingFailed = true;
            patchUpload(image.id, { error: "This image could not be analysed." });
          }
        }
        setStage("imaging", imagingFailed ? "failed" : "done");
      }

      /* -------------------------------------------------- 6. Assessment --- */
      setStage("assessment", "running");

      // `state` is a stale closure by now: the document and imaging dispatches above
      // updated the store, but React has not re-rendered this callback. Building
      // the case from `state` directly would silently send an assessment with no
      // document content. Accumulate the patches locally instead.
      const caseData = buildAssessmentCase({
        ...state,
        uploads: state.uploads.map((upload) => ({
          ...upload,
          ...uploadPatches.get(upload.id),
        })),
      });

      const response = await api.post<{
        result: AssessmentResult;
        triage: TriageResult;
        audit: AuditMetadata;
        rulesetVersion: string;
      }>("/api/ai/assessment", { caseData, intake: intake.intake });

      audit.assessment = response.audit;

      // Persist through the client SDK, scoped by the Security Rules.
      await persistAnalysis({
        userId: uid,
        assessmentId,
        triage: response.triage,
        result: response.result,
        caseData,
        audit,
      });

      await patchAssessment(uid, assessmentId, {
        status: "complete",
        stage: "complete",
        urgency: response.result.urgency.level,
        symptomSummary: buildSymptomSummary(caseData.symptoms, caseData.freeText),
        caseData,
      });

      void writeAuditLog({
        action: "analysis_completed",
        resourceType: "assessment",
        resourceId: assessmentId,
        metadata: {
          model: response.audit.model,
          promptVersion: response.audit.promptVersion,
          latencyMs: response.audit.latencyMs,
          usedFallback: response.audit.usedFallback,
          repairAttempted: response.audit.repairAttempted,
          rulesetVersion: response.rulesetVersion,
          escalatedByRules: response.triage.escalated,
          finalUrgency: response.result.urgency.level,
        },
      });

      dispatch({
        type: "setResult",
        payload: {
          caseData,
          result: response.result,
          triage: response.triage,
          assessmentAudit: response.audit,
          rulesetVersion: response.rulesetVersion,
          busy: false,
          error: null,
        },
      });

      setStage("assessment", "done");
    } catch (error) {
      dispatch({
        type: "setError",
        payload: { message: errorMessage(error, "The analysis could not be completed."), retryable: isRetryable(error) },
      });
      dispatch({ type: "markRunningStagesFailed" });
    } finally {
      runningRef.current = false;
      dispatch({ type: "setBusy", payload: false });
      setRunning(false);
    }
  }, [uid, dispatch, setStage, state]);

  React.useEffect(() => {
    if (startedRef.current || !uid || !state.assessmentId || state.result) return;
    startedRef.current = true;
    void runAnalysis();
    // runAnalysis depends on `state`, which changes throughout the run.
  }, [uid, state.assessmentId, state.result, runAnalysis]);

  const allSettled = state.stages.every(
    (stage) => stage.status === "done" || stage.status === "skipped",
  );

  return (
    <div className="space-y-7">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          {state.result ? "Analysis complete" : "Analysing your information"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Each step below runs only when it is needed, and shows what it actually did. Nothing is
          simulated.
        </p>
      </header>

      <ol className="glass space-y-1 rounded-3xl p-4 sm:p-5" aria-live="polite">
        {state.stages.map((stage, index) => (
          <li key={stage.id}>
            <StageRow stage={stage} index={index} />
          </li>
        ))}
      </ol>

      {state.error ? (
        <div role="alert" className="space-y-3 rounded-3xl border border-critical/30 bg-critical/8 p-5">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
            {state.error}
          </p>
          {state.retryable ? (
            <Button onClick={() => void runAnalysis()} size="sm" disabled={running}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {state.result ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              {allSettled ? "All stages finished." : "Some stages did not complete."}
            </p>
            <Button onClick={() => dispatch({ type: "setStep", payload: 5 })} size="lg">
              <Sparkles className="size-4" aria-hidden="true" />
              View assessment
            </Button>
          </div>
          <MedicalDisclaimer />
        </div>
      ) : null}

      {!state.result && !running ? (
        <Button onClick={() => void runAnalysis()} variant="secondary">
          <RefreshCw className="size-4" aria-hidden="true" />
          Run the analysis again
        </Button>
      ) : null}

      <AnimatePresence>
        {running ? (
          <motion.p
            key="working"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center text-xs text-subtle"
          >
            Keep this page open while analysis runs. Closing or reloading it can interrupt the analysis.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function buildSymptomSummary(
  symptoms: Array<{ name: string }>,
  freeText: string,
): string {
  const names = symptoms.map((s) => s.name.trim()).filter(Boolean).slice(0, 4);
  if (names.length > 0) return names.join(", ").slice(0, 200);
  const firstSentence = freeText.trim().split(/(?<=[.!?])\s/)[0];
  return (firstSentence ?? "").slice(0, 200);
}

function StageRow({ stage, index }: { stage: AnalysisStageState; index: number }) {
  const isRunning = stage.status === "running";
  const isDone = stage.status === "done";

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="flex items-start gap-3 rounded-2xl px-3 py-3"
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
          isDone && "border-good/30 bg-good/12 text-good",
          isRunning && "border-brand/35 bg-brand/12 text-brand",
          stage.status === "failed" && "border-critical/35 bg-critical/12 text-critical",
          stage.status === "skipped" && "border-line bg-muted/8 text-subtle",
          stage.status === "idle" && "border-line bg-muted/5 text-subtle",
        )}
      >
        {isRunning ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : isDone ? (
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        ) : stage.status === "failed" ? (
          <AlertCircle className="size-3.5" aria-hidden="true" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium transition-colors",
            stage.status === "idle" || stage.status === "skipped" ? "text-subtle" : "text-ink",
          )}
        >
          {isRunning ? `${stage.label}…` : stage.label}
          {isDone ? <span className="ml-2 text-xs font-normal text-good">✓ {stage.detail}</span> : null}
          {stage.status === "skipped" ? (
            <span className="ml-2 text-xs font-normal text-subtle">— not needed</span>
          ) : null}
          {stage.status === "failed" ? (
            <span className="ml-2 text-xs font-normal text-critical">— failed</span>
          ) : null}
        </p>
        {isRunning ? <p className="mt-0.5 text-xs text-subtle">{stage.detail}</p> : null}
      </div>
    </motion.div>
  );
}
