"use client";

import * as React from "react";
import { HelpCircle, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MultiOptionList, SelectOptionList } from "@/components/ui/select-options";
import { EmergencyBanner } from "@/components/medical/emergency-banner";
import { WizardNav } from "@/components/assessment/steps/information-symptoms";
import { useWizard, type QuestionAnswer, type WizardStep } from "@/components/assessment/wizard-store";
import type { MedicalQuestion } from "@/types/ai-primitives";

const IMPORTANCE_TONE = {
  high: "critical",
  medium: "caution",
  low: "neutral",
} as const;

const IMPORTANCE_LABEL = {
  high: "High importance",
  medium: "Useful",
  low: "Context",
} as const;

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: MedicalQuestion;
  value: QuestionAnswer | undefined;
  onChange: (value: QuestionAnswer) => void;
}) {
  const id = `q-${question.id}`;

  switch (question.type) {
    case "yes_no":
      return (
        <SelectOptionList
          name={id}
          value={value === undefined ? "" : value === true || value === "yes" ? "yes" : "no"}
          onValueChange={(next) => onChange(next === "yes")}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
      );

    case "single_choice":
      return (
        <SelectOptionList
          name={id}
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          options={(question.options ?? []).map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      );

    case "multiple_choice":
      return (
        <MultiOptionList
          name={id}
          values={Array.isArray(value) ? value : []}
          onValuesChange={onChange}
          options={(question.options ?? []).map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      );

    case "number":
    case "temperature": {
      const numeric = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
      return (
        <div className="max-w-xs space-y-1.5">
          <label htmlFor={id} className="sr-only">
            {question.question}
          </label>
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            value={numeric}
            min={0}
            max={1100}
            step={question.type === "temperature" ? 0.1 : 1}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange("");
                return;
              }
              const parsed = Number.parseFloat(raw);
              onChange(Number.isFinite(parsed) ? parsed : raw);
            }}
            placeholder={question.placeholder ?? "Enter a number"}
            {...(question.unit ? { "aria-describedby": `${id}-unit` } : {})}
          />
          {question.unit ? (
            <p id={`${id}-unit`} className="text-xs text-subtle">
              Unit: {question.unit}
            </p>
          ) : null}
        </div>
      );
    }

    case "duration":
      return (
        <div className="max-w-md space-y-1.5">
          <label htmlFor={id} className="sr-only">
            {question.question}
          </label>
          <Input
            id={id}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={question.placeholder ?? "for example: 3 days, about two weeks"}
            maxLength={200}
          />
        </div>
      );

    case "text":
    default:
      return (
        <div className="max-w-2xl space-y-1.5">
          <label htmlFor={id} className="sr-only">
            {question.question}
          </label>
          <Textarea
            id={id}
            rows={3}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={question.placeholder ?? "Type your answer"}
            maxLength={2_000}
          />
        </div>
      );
  }
}

export function StepQuestions() {
  const { state, dispatch, runSafetyCheck } = useWizard();
  const [loading, setLoading] = React.useState(
    state.questions.length === 0 && state.questionsSource === "pending",
  );
  const [error, setError] = React.useState<string | null>(null);
  const { loadQuestions } = useQuestionLoader();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadQuestions();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The questions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [loadQuestions]);

  React.useEffect(() => {
    if (state.questionsSource === "pending" && !loading) {
      void load();
    }
    // Intentionally runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run the deterministic safety layer as answers arrive. Free — no model call,
  // so this can safely run on every change and surface an emergency immediately.
  const answerCount = Object.keys(state.answers).length;
  React.useEffect(() => {
    if (answerCount === 0) return;
    void runSafetyCheck();
    // Only re-run when the number of answers changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerCount]);

  const answered = state.questions.filter((question) => {
    const value = state.answers[question.id];
    return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
  }).length;

  const setAnswer = (question: MedicalQuestion, value: QuestionAnswer) => {
    dispatch({ type: "setAnswer", payload: { id: question.id, answer: value } });
  };

  const goNext = () => {
    dispatch({ type: "setStep", payload: 3 as WizardStep });
  };

  return (
    <div className="space-y-7">
      {state.triage?.emergencyNotice ? (
        <EmergencyBanner triage={state.triage} />
      ) : null}

      <header>
        <Badge tone="brand">Step 3</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
          A few questions worth asking
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          These were chosen because the answer would genuinely change how your symptoms are
          understood. Any of them can be skipped.
        </p>
      </header>

      {state.questionNotice ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-caution/30 bg-caution-soft/40 p-3.5 text-sm leading-relaxed text-ink"
        >
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
          {state.questionNotice}
        </p>
      ) : null}

      {loading ? (
        <div className="glass space-y-4 rounded-3xl p-5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin text-brand" aria-hidden="true" />
            Choosing the most useful questions to ask…
          </p>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="space-y-2">
              <div className="skeleton h-3.5" style={{ width: `${[70, 55, 80, 45][index]}%` }} />
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="skeleton h-10" />
                <div className="skeleton h-10" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="glass space-y-4 rounded-3xl p-5" role="alert">
          <p className="text-sm text-ink">{error}</p>
          <Button onClick={() => void load()} size="sm">
            Try again
          </Button>
        </div>
      ) : (
        <>
          {state.questionRationale ? (
            <p className="text-sm leading-relaxed text-muted">{state.questionRationale}</p>
          ) : null}

          <ol className="space-y-4">
            {state.questions.map((question, index) => (
              <li key={question.id}>
                <div className="glass rounded-3xl p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-start gap-2.5 text-sm font-medium text-ink">
                      <span className="mt-px text-xs tabular-nums text-brand">{index + 1}.</span>
                      {question.question}
                    </p>
                    <Badge tone={IMPORTANCE_TONE[question.importance]} size="sm" className="shrink-0">
                      {IMPORTANCE_LABEL[question.importance]}
                    </Badge>
                  </div>

                  {question.rationale ? (
                    <p className="mt-1.5 flex items-start gap-1.5 pl-6 text-xs leading-relaxed text-subtle">
                      <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      {question.rationale}
                    </p>
                  ) : null}

                  <div className="mt-4 pl-0 sm:pl-6">
                    <QuestionField
                      question={question}
                      value={state.answers[question.id]}
                      onChange={(value) => setAnswer(question, value)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <WizardNav
        onBack={() => dispatch({ type: "setStep", payload: 1 as WizardStep })}
        onNext={goNext}
        nextLabel={loading ? "Loading questions" : "Continue to documents"}
        nextBusy={loading}
        nextDisabled={loading}
        hint={
          state.questions.length > 0
            ? `${answered} of ${state.questions.length} answered. Skipped questions are recorded as unanswered.`
            : undefined
        }
      />
    </div>
  );
}

/**
 * Question loading, extracted so the step component stays declarative.
 *
 * Sends only the summarised intake, not the whole case, to keep the prompt small.
 */
function useQuestionLoader() {
  const { state, dispatch } = useWizard();

  return React.useMemo(
    () => ({
      loadQuestions: async () => {
        const { api } = await import("@/lib/api/client");

        const response = await api.post<{
          questions: { questions: MedicalQuestion[]; rationale: string };
          source: "model" | "fallback";
          notice?: string;
        }>("/api/ai/questions", {
          freeText: state.caseData.freeText,
          age: state.caseData.demographics.age,
          sex: state.caseData.demographics.sex || undefined,
          symptoms: state.caseData.symptoms.map((s) => s.name),
          ...(state.intake ? { intake: state.intake } : {}),
        });

        dispatch({
          type: "setQuestions",
          payload: {
            questions: response.questions.questions,
            questionRationale: response.questions.rationale,
            questionsSource: response.source,
            questionNotice: response.notice ?? null,
            error: null,
          },
        });
      },
    }),
    [state.caseData, state.intake, dispatch],
  );
}