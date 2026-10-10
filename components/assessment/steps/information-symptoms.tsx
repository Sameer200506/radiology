"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Info, Lock, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { EmergencyBanner } from "@/components/medical/emergency-banner";
import { useWizard, type WizardStep } from "@/components/assessment/wizard-store";
import type { MedicalCase, Sex } from "@/types/medical";

const SEX_OPTIONS: Array<{ value: Sex; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

const COMMON_SYMPTOMS = [
  "Fever",
  "Cough",
  "Sore throat",
  "Headache",
  "Fatigue",
  "Body aches",
  "Runny nose",
  "Nausea",
  "Abdominal pain",
  "Diarrhoea",
  "Dizziness",
  "Rash",
  "Breathlessness",
  "Chest pain",
  "Back pain",
  "Joint pain",
  "Sleep problems",
  "Weight loss",
  "Numbness or tingling",
  "Palpitations",
] as const;

/** Step 1 — basic information. Deliberately short; nothing is required. */
export function StepInformation() {
  const { state, dispatch, createAssessment, runSafetyCheck } = useWizard();
  const [age, setAge] = React.useState(state.caseData.demographics.age?.toString() ?? "");
  const [sex, setSex] = React.useState<Sex>(state.caseData.demographics.sex ?? "");

  const goNext = async () => {
    const parsedAge = age.trim() === "" ? undefined : Number.parseInt(age, 10);
    const validAge =
      parsedAge !== undefined && Number.isFinite(parsedAge) && parsedAge >= 0 && parsedAge <= 130
        ? parsedAge
        : undefined;

    const demographics = {
      ...state.caseData.demographics,
      ...(validAge !== undefined ? { age: validAge } : {}),
      ...(sex ? { sex } : {}),
    };
    const caseData: MedicalCase = { ...state.caseData, demographics };

    dispatch({ type: "setDemographics", payload: demographics });

    await createAssessment({ caseData });
    await runSafetyCheck(caseData);
    dispatch({ type: "setStep", payload: 1 as WizardStep });
  };

  return (
    <div className="space-y-7">
      {state.triage?.emergencyNotice ? (
        <EmergencyBanner triage={state.triage} />
      ) : null}

      <header>
        <Badge tone="brand">Step 1</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">Basic information</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Optional, but age and sex change which explanations are worth considering. Nothing here is
          stored on any identification record — it is attached only to this assessment.
        </p>
      </header>

      <div className="glass grid gap-5 rounded-3xl p-5 sm:p-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="age" className="text-sm font-medium text-ink">
            Age
          </label>
          <Input
            id="age"
            type="number"
            inputMode="numeric"
            min={0}
            max={130}
            value={age}
            onChange={(event) => setAge(event.target.value)}
            placeholder="e.g. 34"
            hint="Leave blank if you prefer not to share."
            aria-describedby="age-hint"
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-ink">Sex (clinically relevant)</legend>
          <div className="flex flex-wrap gap-2 pt-1">
            {SEX_OPTIONS.map((option) => {
              const selected = sex === option.value;
              return (
                <label
                  key={option.value || "none"}
                  className={cn(
                    "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                    selected ? "border-brand bg-brand/10 font-medium text-brand" : "border-line text-muted hover:border-brand/40",
                  )}
                >
                  <input
                    type="radio"
                    name="sex"
                    value={option.value}
                    checked={selected}
                    onChange={() => setSex(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="glass flex items-start gap-3 rounded-3xl p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Lock className="size-[1.05rem]" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Why we ask</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Age and sex affect how common various conditions are and which reference ranges apply to
            your documents. They are stored with this assessment only, and you can delete the whole
            assessment at any time.
          </p>
        </div>
      </div>

      <MedicalDisclaimer />

      <WizardNav onBack={undefined} onNext={goNext} nextLabel="Continue to symptoms" />
    </div>
  );
}

/** Step 2 — symptoms: pick from the list, or describe in your own words. */
export function StepSymptoms() {
  const { state, dispatch, runSafetyCheck, save } = useWizard();
  const [selected, setSelected] = React.useState<string[]>(
    state.caseData.symptoms.map((s) => s.name).filter(Boolean),
  );
  const [freeText, setFreeText] = React.useState(state.caseData.freeText);
  const [duration, setDuration] = React.useState(
    state.caseData.symptoms.find((s) => s.duration)?.duration ?? "",
  );
  const [severity, setSeverity] = React.useState(
    state.caseData.symptoms.find((s) => s.severity)?.severity ?? "",
  );
  const [textError, setTextError] = React.useState<string | null>(null);

  const toggle = (symptom: string) => {
    setSelected((current) =>
      current.includes(symptom) ? current.filter((s) => s !== symptom) : [...current, symptom],
    );
  };

  const canContinue = selected.length > 0 || freeText.trim().length >= 4;

  const goNext = async () => {
    if (selected.length === 0 && freeText.trim().length < 4) {
      setTextError("Choose at least one symptom, or describe the problem in your own words.");
      return;
    }
    setTextError(null);

    // Keep the first selected symptom carrying duration/severity so the case
    // snapshot stays compact but still time-scoped.
    const symptoms = selected.map((name, index) => ({
      name,
      source: "user_selected" as const,
      ...(index === 0 && duration.trim() ? { duration: duration.trim() } : {}),
      ...(index === 0 && severity.trim() ? { severity: severity.trim() } : {}),
    }));

    const caseData: MedicalCase = { ...state.caseData, symptoms, freeText: freeText.trim() };

    dispatch({ type: "setCaseField", payload: { field: "symptoms", value: symptoms } });
    dispatch({ type: "setCaseField", payload: { field: "freeText", value: freeText.trim() } });

    await runSafetyCheck(caseData);
    await save(caseData, 1);
    dispatch({ type: "setStep", payload: 2 as WizardStep });
  };

  return (
    <div className="space-y-7">
      {state.triage?.emergencyNotice ? (
        <EmergencyBanner triage={state.triage} />
      ) : state.triage?.redFlags.length ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-caution/30 bg-caution-soft/40 p-4"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-ink">
            Some of what you have described matches a pattern this application treats as needing
            prompt review:{" "}
            <strong className="font-semibold">{state.triage.redFlags.map((f) => f.flag).join(", ")}</strong>.
            Keep going if you can, but consider contacting a healthcare professional rather than
            waiting.
          </p>
        </div>
      ) : null}

      <header>
        <Badge tone="brand">Step 2</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
          What is happening?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Pick what applies, then add anything the list missed in your own words. Your own
          description usually helps more than the selected labels.
        </p>
      </header>

      <div className="glass rounded-3xl p-5 sm:p-6">
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Common symptoms{" "}
            <span className="font-normal text-subtle">(select all that apply)</span>
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {COMMON_SYMPTOMS.map((symptom) => {
              const isSelected = selected.includes(symptom);
              return (
                <label
                  key={symptom}
                  className={cn(
                    "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-all",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                    isSelected
                      ? "border-brand bg-brand/10 font-medium text-brand"
                      : "border-line text-muted hover:border-brand/40 hover:bg-brand/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(symptom)}
                    className="sr-only"
                  />
                  {symptom}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="duration" className="text-sm font-medium text-ink">
              How long have you had this?
            </label>
            <Input
              id="duration"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder="e.g. 6 days, 3 weeks"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="severity" className="text-sm font-medium text-ink">
              How severe is it?
            </label>
            <Input
              id="severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              placeholder="e.g. mild, stops me doing things"
              maxLength={200}
            />
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl p-5 sm:p-6">
        <div className="space-y-1.5">
          <label htmlFor="freeText" className="text-sm font-medium text-ink">
            Describe it in your own words
          </label>
          <textarea
            id="freeText"
            rows={5}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            maxLength={4_000}
            placeholder="For example: I have had a cough for about six days and it is not improving. I measured 38.4 in the evening and I am bringing up yellow phlegm. I feel tired but I can still walk to work."
            aria-invalid={textError ? true : undefined}
            aria-describedby={textError ? "freeText-error" : "freeText-hint"}
            className={cn(
              "w-full resize-y rounded-xl border bg-surface/70 px-3.5 py-3 text-sm leading-relaxed text-ink transition-colors",
              "placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/12",
              textError ? "border-critical/60" : "border-line",
            )}
          />
          <p id="freeText-hint" className="flex items-start gap-1.5 text-xs text-subtle">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>
              Include what you have noticed, when it started, and how it is changing. Please avoid
              adding your name or other identifying details.
            </span>
          </p>
          {textError ? (
            <p id="freeText-error" role="alert" className="text-xs font-medium text-critical">
              {textError}
            </p>
          ) : null}
        </div>
      </div>

      <WizardNav
        onBack={() => dispatch({ type: "setStep", payload: 0 as WizardStep })}
        onNext={goNext}
        nextDisabled={!canContinue}
        nextLabel="Continue to questions"
      />
    </div>
  );
}

/** Shared wizard footer navigation. */
export function WizardNav({
  onBack,
  onNext,
  nextLabel = "Continue",
  backLabel = "Back",
  nextDisabled = false,
  nextBusy = false,
  hint,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  nextBusy?: boolean;
  hint?: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-8 border-t border-line/70 bg-canvas/85 px-4 py-4 backdrop-blur-lg sm:-mx-6 sm:px-6">
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button variant="ghost" onClick={onBack} type="button">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {backLabel}
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {hint ? (
            <p className="text-xs text-subtle sm:text-right">{hint}</p>
          ) : null}
          <Button
            onClick={onNext}
            type="button"
            size="lg"
            disabled={nextDisabled}
            loading={nextBusy}
            className="group"
          >
            {nextLabel}
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
    </div>
  );
}

export { Sparkles };
