"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Beaker, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressIndicator } from "@/components/assessment/progress";
import { StepInformation, StepSymptoms } from "@/components/assessment/steps/information-symptoms";
import { StepQuestions } from "@/components/assessment/steps/questions";
import { StepDocuments } from "@/components/assessment/steps/documents";
import { StepAnalysis } from "@/components/assessment/steps/analysis";
import { ResultsView } from "@/components/medical/results-view";
import { EmergencyBanner } from "@/components/medical/emergency-banner";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { buildAssessmentCase, useWizard, type WizardStep } from "@/components/assessment/wizard-store";
import { useAuth } from "@/components/auth/auth-provider";
import { DEMO_SCENARIOS } from "@/lib/medical/demo-data";
import type { AssessmentResult } from "@/types/assessment";

/**
 * Report actions pull in jsPDF, which is heavy. Loaded only when the user
 * reaches the results step.
 */
const ReportActions = dynamic(
  () => import("@/components/reports/report-actions").then((mod) => mod.ReportActions),
  {
    ssr: false,
    loading: () => (
      <div className="glass h-20 animate-pulse rounded-3xl" aria-hidden="true" />
    ),
  },
);

import type { ReportActionsProps } from "@/components/reports/report-actions";

/**
 * The assessment wizard.
 *
 * One client-side store, six steps. Every step persists its slice to the server
 * before advancing, so a refresh or a crash never loses entered information.
 */
export function AssessmentWizard() {
  const router = useRouter();
  const { state, dispatch, createAssessment } = useWizard();
  const { user } = useAuth();
  // A draft starts with an id before its async data has loaded, so it must not
  // be hidden behind the new-assessment chooser.
  const [showStart, setShowStart] = React.useState(() => state.assessmentId === null);
  const [startingDemo, setStartingDemo] = React.useState<string | null>(null);

  // The report is rendered from the same snapshot the analysis actually used,
  // so print, PDF and screen cannot drift apart.
  const analysisForReport: ReportActionsProps["analysis"] | null =
    state.result && state.assessmentId && state.triage
      ? {
          result: state.result,
          triage: state.triage,
          caseData: buildAssessmentCase(state),
          audit: {
            intake: state.intakeAudit ?? undefined,
            assessment: state.assessmentAudit ?? undefined,
          },
          assessmentId: state.assessmentId,
        }
      : null;

  const navigate = (step: WizardStep) => {
    dispatch({ type: "setStep", payload: step });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const startDemo = async (scenarioId: string) => {
    if (startingDemo) return;
    setStartingDemo(scenarioId);
    dispatch({ type: "clearError" });
    try {
      await createAssessment({ demo: true, scenarioId });
      setShowStart(false);
    } catch {
      // The provider exposes the creation error in the chooser, so the person
      // can try again without being sent into an unsaved demo state.
      setShowStart(true);
    } finally {
      setStartingDemo(null);
    }
  };

  const startFromScratch = () => {
    dispatch({ type: "clearError" });
    setShowStart(false);
  };

  const startOver = () => {
    dispatch({ type: "reset" });
    setShowStart(true);
    // Next.js preserves client state for same-route navigations. Reset the
    // store explicitly, then remove any stale draft id from the address bar.
    router.replace("/assessment/new");
  };

  if (state.hydratingDraft) {
    return (
      <div className="glass flex min-h-64 flex-col items-center justify-center rounded-3xl p-6 text-center" role="status" aria-live="polite">
        <Loader2 className="size-5 animate-spin text-brand" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-ink">Restoring your assessment</p>
        <p className="mt-1 text-sm text-muted">Loading your saved information and uploads…</p>
      </div>
    );
  }

  if (showStart) {
    return (
      <div className="space-y-7">
        <header>
          <Badge tone="brand">New assessment</Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Before you start</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Start from scratch, or explore the whole workflow with a synthetic demo patient first.
            The demo data is invented — no real medical information is involved.
          </p>
          {state.error ? <WorkflowError message={state.error} /> : null}
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass relative flex flex-col overflow-hidden rounded-3xl p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-brand/15 blur-3xl motion-safe:animate-drift"
            />
            <span className="relative flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <h2 className="relative mt-4 text-base font-semibold tracking-tight text-ink">
              Start a real assessment
            </h2>
            <p className="relative mt-2 flex-1 text-sm leading-relaxed text-muted">
              Describe your own symptoms and optionally upload your own reports. Everything stays in
              your account and you can delete it at any time.
            </p>
            <Button className="relative mt-6" size="lg" onClick={startFromScratch} disabled={startingDemo !== null}>
              Start assessment
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="glass relative flex flex-col overflow-hidden rounded-3xl border-accent/25 bg-accent/5 p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-20 -left-10 size-44 rounded-full bg-accent/15 blur-3xl motion-safe:animate-drift-slow"
            />
            <div className="relative flex items-center gap-2">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <Beaker className="size-5" aria-hidden="true" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">Explore a demo</h2>
            </div>
            <p className="relative mt-3 flex-1 text-sm leading-relaxed text-muted">
              Three fictional scenarios covering the normal path, the emergency safety path, and
              report review.
            </p>
            <ul className="relative mt-4 space-y-2">
              {DEMO_SCENARIOS.map((scenario) => (
                <li key={scenario.id}>
                  <button
                    type="button"
                    onClick={() => void startDemo(scenario.id)}
                    disabled={startingDemo !== null}
                    className="flex w-full items-center gap-3 rounded-xl border border-line/80 bg-surface/45 px-3.5 py-3 text-left backdrop-blur-sm transition-colors hover:border-accent/45 hover:bg-accent/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {startingDemo === scenario.id ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-accent" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {scenario.name}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
                        {scenario.teaches}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <MedicalDisclaimer />
      </div>
    );
  }

  return (
    <div className="pb-4">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
        </Button>
        {state.isDemo ? (
          <Badge tone="accent">Synthetic demo data — not a real patient</Badge>
        ) : null}
      </div>

      <ProgressIndicator step={state.step} maxStepReached={state.maxStepReached} onNavigate={navigate} />

      {state.error && state.step !== 4 ? <WorkflowError message={state.error} /> : null}

      {state.step <= 2 && state.triage?.emergencyNotice ? (
        <div className="mb-7">
          <EmergencyBanner triage={state.triage} />
        </div>
      ) : null}

      {state.step === 0 ? <StepInformation /> : null}
      {state.step === 1 ? <StepSymptoms /> : null}
      {state.step === 2 ? <StepQuestions /> : null}
      {state.step === 3 ? <StepDocuments /> : null}
      {state.step === 4 ? <StepAnalysis /> : null}
      {state.step === 5 ? (
        <ResultStep
          result={state.result}
          analysis={analysisForReport}
          userId={user?.uid}
          onBackToAnalysis={() => dispatch({ type: "setStep", payload: 4 })}
          onStartOver={startOver}
        />
      ) : null}
    </div>
  );
}

function WorkflowError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-2xl border border-critical/30 bg-critical/8 p-3.5 text-sm leading-relaxed text-ink"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
      {message}
    </p>
  );
}

function ResultStep({
  result,
  analysis,
  userId,
  onBackToAnalysis,
  onStartOver,
}: {
  result: AssessmentResult | null;
  analysis: ReportActionsProps["analysis"] | null;
  userId: string | undefined;
  onBackToAnalysis: () => void;
  onStartOver: () => void;
}) {
  if (!result) {
    return (
      <div className="glass rounded-3xl p-6">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-ink" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
          No assessment result is available yet. Run the analysis step first.
        </p>
        <Button className="mt-5" variant="secondary" onClick={onBackToAnalysis}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Go to analysis
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="text-center">
        <Badge tone="brand" size="lg">
          AI-Assisted Health Assessment
        </Badge>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Assessment completed</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Everything below was generated from the information you provided and the documents you
          uploaded. Read the limitations at the end before deciding what to do with it.
        </p>
      </header>

      {result.urgency.level === "EMERGENCY" ? (
        <EmergencyBanner
          triage={{
            level: "EMERGENCY",
            emergencyNotice:
              "Contact your local emergency number or go to the nearest emergency department now. Do not wait for or rely on this assessment.",
          }}
        />
      ) : null}

      <div className="glass-strong rounded-3xl p-5 sm:p-7">
        <p className="eyebrow">Overall summary</p>
        <p className="mt-3 text-pretty text-base leading-relaxed text-ink">{result.summary}</p>
      </div>

      {analysis ? <ReportActions analysis={analysis} userId={userId} /> : null}

      <ResultsView result={result} />

      <MedicalDisclaimer variant="card" />

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:justify-center">
        <Button asChild variant="secondary">
          <Link href="/dashboard/assessments">Back to my assessments</Link>
        </Button>
        <Button variant="ghost" onClick={onStartOver}>
          Start another assessment
        </Button>
      </div>
    </div>
  );
}
