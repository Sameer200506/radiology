"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { STEP_LABELS, useWizard, type WizardStep } from "@/components/assessment/wizard-store";

/**
 * Progress indicator.
 *
 * Rendered as an ordered list so the sequence is available to assistive tech,
 * and the current step is marked with aria-current="step". Completed steps are
 * navigable; future steps are not.
 */
export function ProgressIndicator({
  step,
  maxStepReached,
  onNavigate,
}: {
  step: WizardStep;
  maxStepReached: WizardStep;
  onNavigate: (step: WizardStep) => void;
}) {
  const total = STEP_LABELS.length;
  const percent = ((step + 1) / total) * 100;

  return (
    <nav aria-label="Assessment progress" className="mb-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-ink">
          Step {step + 1} of {total}
          <span className="ml-2 font-normal text-subtle">{STEP_LABELS[step]}</span>
        </p>
        <p className="text-xs tabular-nums text-subtle" aria-hidden="true">
          {Math.round(percent)}%
        </p>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/15"
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Assessment progress: step ${step + 1} of ${total}`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {STEP_LABELS.map((label, index) => {
          const indexStep = index as WizardStep;
          const isCurrent = indexStep === step;
          const isDone = indexStep < step;
          const isReachable = indexStep <= maxStepReached;

          return (
            <li key={label} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => isReachable && onNavigate(indexStep)}
                disabled={!isReachable}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  isCurrent && "bg-brand/12 font-semibold text-brand",
                  isDone && "text-good",
                  !isCurrent && !isDone && "text-subtle",
                  isReachable && !isCurrent && !isDone && "hover:bg-muted/10 hover:text-ink",
                  !isReachable && "cursor-not-allowed opacity-60",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border text-[0.5625rem] font-semibold tabular-nums",
                    isCurrent && "border-brand bg-brand text-white",
                    isDone && "border-good/40 bg-good/12 text-good",
                    !isCurrent && !isDone && "border-line-strong",
                  )}
                  aria-hidden="true"
                >
                  {isDone ? <Check className="size-2.5" strokeWidth={4} /> : index + 1}
                </span>
                {label}
              </button>

              {index < total - 1 ? (
                <span className="text-subtle/40" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Sticky in-page section navigation for a completed result. */
export function ResultTableOfContents({
  sections,
  activeId,
}: {
  sections: Array<{ id: string; label: string }>;
  activeId: string;
}) {
  return (
    <nav aria-label="Result sections" className="no-print">
      <ul className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={cn(
                "inline-flex whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors",
                activeId === section.id
                  ? "bg-brand/12 font-medium text-brand"
                  : "text-muted hover:bg-muted/10 hover:text-ink",
              )}
              aria-current={activeId === section.id ? "true" : undefined}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function StepLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-brand underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </Link>
  );
}

export { STEP_LABELS, useWizard };