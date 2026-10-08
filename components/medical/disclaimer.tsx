import * as React from "react";
import { ShieldAlert, Stethoscope } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The application's core safety disclaimer.
 *
 * Rendered on the landing page, the intake step, and — non-dismissably — at the
 * bottom of every results page and generated report.
 */
export function MedicalDisclaimer({
  variant = "inline",
  className,
}: {
  variant?: "inline" | "card" | "footer";
  className?: string;
}) {
  const content = (
    <>
      <p className="text-sm leading-relaxed">
        <strong className="font-semibold">MedAssist AI is not a diagnostic device.</strong> It does not
        examine you, order tests, or replace a healthcare professional. Everything it produces is
        AI-generated decision support based only on what you typed and what was readable in the
        documents you uploaded. It can be incomplete or wrong.
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        Nothing here is a diagnosis. Possible explanations are hypotheses to discuss with a
        qualified clinician, not conclusions. Always have your original reports and images reviewed
        by the professional treating you.
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong className="font-semibold">If you may be experiencing a medical emergency,</strong>{" "}
        contact your local emergency number or go to the nearest emergency department now. Do not
        wait for an assessment here, and do not rely on this application in place of urgent care.
      </p>
    </>
  );

  if (variant === "card") {
    return (
      <aside
        aria-labelledby="medical-disclaimer-heading"
        className={cn(
          "glass rounded-3xl border-caution/25 bg-caution-soft/40 p-5 sm:p-6",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-caution/15 text-caution">
            <ShieldAlert className="size-[1.15rem]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="medical-disclaimer-heading"
              className="text-sm font-semibold tracking-tight text-ink"
            >
              Important: this is not a diagnosis
            </h2>
            <div className="mt-2 text-muted">{content}</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-labelledby="medical-disclaimer-heading"
      className={cn("rounded-2xl border border-caution/25 bg-caution-soft/30 p-4", className)}
    >
      <h2 id="medical-disclaimer-heading" className="sr-only">
        Medical disclaimer
      </h2>
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
        <div className="min-w-0 text-xs leading-relaxed text-muted">{content}</div>
      </div>
    </aside>
  );
}

/**
 * Provenance label. Every statement in the UI is tagged with where it came from,
 * which is the mechanism that keeps user input, extracted data and AI
 * interpretation from blurring together.
 */
export function EvidenceTag({
  category,
  className,
  compact = false,
}: {
  category:
    | "user_provided"
    | "extracted_from_document"
    | "ai_generated_interpretation"
    | "possible_explanation"
    | "risk_urgency_assessment"
    | "recommended_next_step";
  className?: string;
  compact?: boolean;
}) {
  const config = {
    user_provided: { label: "You told us", short: "You", tone: "bg-info/10 text-info border-info/25" },
    extracted_from_document: {
      label: "Extracted from your document",
      short: "From document",
      tone: "bg-brand/10 text-brand border-brand/25",
    },
    ai_generated_interpretation: {
      label: "AI interpretation",
      short: "AI",
      tone: "bg-accent/10 text-accent border-accent/25",
    },
    possible_explanation: {
      label: "Possible explanation — not a diagnosis",
      short: "Possible",
      tone: "bg-caution/10 text-caution border-caution/30",
    },
    risk_urgency_assessment: {
      label: "Urgency assessment",
      short: "Urgency",
      tone: "bg-caution/12 text-caution border-caution/35",
    },
    recommended_next_step: {
      label: "Suggested next step",
      short: "Next step",
      tone: "bg-good/10 text-good border-good/25",
    },
  }[category];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em]",
        config.tone,
        className,
      )}
      title={config.label}
    >
      {compact ? config.short : config.label}
    </span>
  );
}

/** Small "verified by a professional" reminder shown next to AI interpretation. */
export function ClinicianReviewNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-subtle">
      <Stethoscope className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}