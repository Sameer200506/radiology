"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CircleHelp,
  FileWarning,
  Info,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  Stethoscope,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Badge, UrgencyBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { urgencyPresentation } from "@/lib/medical/urgency";
import { EvidenceTag } from "@/components/medical/disclaimer";
import type { AssessmentResult, KeyFinding, RecommendedNextStep } from "@/types/assessment";
import type { UrgencyLevel } from "@/types/medical";

const SOURCE_LABEL: Record<KeyFinding["source"], string> = {
  symptoms: "Your symptoms",
  answers: "Your answers",
  document: "Your document",
  imaging: "Image observation",
  demographics: "Your age/sex",
  history: "Your history",
};

const SOURCE_TAG: Record<KeyFinding["source"], React.ComponentProps<typeof EvidenceTag>["category"]> = {
  symptoms: "user_provided",
  answers: "user_provided",
  demographics: "user_provided",
  history: "user_provided",
  document: "extracted_from_document",
  imaging: "ai_generated_interpretation",
};

const TIMELINE_META: Record<RecommendedNextStep["timeframe"], { label: string; tone: string }> = {
  immediately: { label: "Immediately", tone: "critical" },
  within_24_hours: { label: "Within 24 hours", tone: "critical" },
  within_48_hours: { label: "Within 48 hours", tone: "caution" },
  within_1_week: { label: "Within a week", tone: "caution" },
  routine_follow_up: { label: "Routine follow-up", tone: "good" },
};

const CATEGORY_LABEL: Record<RecommendedNextStep["category"], string> = {
  seek_emergency_care: "Emergency care",
  seek_urgent_care: "Urgent care",
  book_clinician: "Book an appointment",
  self_care: "Self-care",
  monitor: "Monitor",
  information_gathering: "Gather information",
};

function SectionHeading({
  icon: Icon,
  title,
  description,
  tag,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  tag?: React.ComponentProps<typeof EvidenceTag>["category"];
  id: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 id={id} className="text-base font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {tag ? <EvidenceTag category={tag} /> : null}
      </div>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
    </div>
  );
}

export function ResultsView({ result }: { result: AssessmentResult }) {
  const urgency = urgencyPresentation(result.urgency.level);

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------------- Urgency --- */}
      <section aria-labelledby="urgency-heading" className="scroll-mt-24">
        <SectionHeading
          id="urgency-heading"
          icon={AlertTriangle}
          title="Urgency"
          description="This is an indication of how quickly a healthcare professional would want to review this, based on the information you provided."
          tag="risk_urgency_assessment"
        />

        <Card
          variant="glass-strong"
          padding="lg"
          className={cn(
            "border-l-4",
            result.urgency.level === "EMERGENCY" && "border-critical",
            result.urgency.level === "URGENT" && "border-caution",
            result.urgency.level === "PROMPT_MEDICAL_REVIEW" && "border-caution",
            result.urgency.level === "NON_URGENT" && "border-info",
            result.urgency.level === "ROUTINE" && "border-good",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <UrgencyBadge level={result.urgency.level} size="lg" />
              <p className="mt-3 text-sm leading-relaxed text-muted">{urgency.description}</p>
            </div>
            <span className="sr-only">{urgency.srAnnouncement}</span>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-ink">{result.urgency.reason}</p>

          {result.urgency.overriddenBySafetyRules ? (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-caution/30 bg-caution-soft/50 p-3.5">
              <Info className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-ink">
                The AI initially suggested{" "}
                <strong className="font-semibold">
                  {result.urgency.aiSuggestedLevel?.replace(/_/g, " ")}
                </strong>
                . The level shown here was raised by the application&apos;s deterministic safety
                rules, which take priority.
              </p>
            </div>
          ) : null}

          {result.redFlags.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-ink">Concerning findings</h3>
              <ul className="mt-2.5 space-y-2.5">
                {result.redFlags.map((flag, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm">
                    <FileWarning
                      className="mt-0.5 size-4 shrink-0 text-caution"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-ink">{flag.flag}</p>
                      <p className="mt-0.5 text-muted">{flag.why}</p>
                      <p className="mt-1 text-xs text-subtle">
                        Detected by:{" "}
                        {flag.source === "deterministic_rule"
                          ? "the safety rules"
                          : flag.source === "user_stated"
                            ? "your own description"
                            : "the AI review"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </section>

      {/* ------------------------------------------------ Key findings ---- */}
      {result.keyFindings.length > 0 ? (
        <section aria-labelledby="key-findings-heading" className="scroll-mt-24">
          <SectionHeading
            id="key-findings-heading"
            icon={Activity}
            title="Key findings"
            description="Each finding is tagged with where it came from, so you can tell your own words from your document from the model's interpretation."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {result.keyFindings.map((finding, index) => (
              <Card key={index} variant="glass" hover="lift" className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold leading-snug text-ink">{finding.title}</h3>
                  <EvidenceTag category={SOURCE_TAG[finding.source]} compact />
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{finding.detail}</p>
                <p className="mt-3 text-xs text-subtle">Source: {SOURCE_LABEL[finding.source]}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------- Possible explanations */}
      <section aria-labelledby="explanations-heading" className="scroll-mt-24">
        <SectionHeading
          id="explanations-heading"
          icon={ListChecks}
          title="Possible explanations"
          description="Ranked hypotheses that fit the information you provided. These are possibilities to discuss, not conclusions."
          tag="possible_explanation"
        />

        <div className="glass rounded-3xl border-caution/25 p-5">
          <p className="text-sm font-medium text-ink">
            These are possible explanations, not confirmed diagnoses.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Each one is a hypothesis based only on what you entered and what was readable in your
            documents. Confirming or excluding any of them requires examination, history and
            appropriate testing by a qualified professional.
          </p>
        </div>

        <ol className="mt-4 space-y-3">
          {result.possibleExplanations.map((explanation) => (
            <li key={explanation.rank}>
              <Card variant="glass" className="h-full">
                <div className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-semibold tabular-nums text-accent">
                    {explanation.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold leading-snug text-ink">
                      {explanation.explanation}
                    </h3>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
                        Why it may fit
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {explanation.whyItMayFit.map((reason, index) => (
                          <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                            <span aria-hidden="true" className="text-brand">•</span>
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {explanation.whatWouldTestIt.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
                          What a clinician would check
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {explanation.whatWouldTestIt.map((test, index) => (
                            <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                              <span aria-hidden="true" className="text-brand">•</span>
                              {test}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted/6 px-3 py-2 text-xs leading-relaxed text-subtle">
                      <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {explanation.confidenceNote}
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------- Symptom analysis ------- */}
      {result.symptomAnalysis.length > 0 ? (
        <section aria-labelledby="symptoms-heading" className="scroll-mt-24">
          <SectionHeading
            id="symptoms-heading"
            icon={Activity}
            title="Your symptoms"
            description="What you reported, and how it was interpreted."
          />

          <ul className="space-y-3">
            {result.symptomAnalysis.map((item, index) => (
              <li key={index}>
                <Card variant="glass">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{item.symptom}</h3>
                    {item.durationNote ? (
                      <Badge tone="neutral" size="sm">
                        Duration: {item.durationNote}
                      </Badge>
                    ) : null}
                    {item.severityNote ? (
                      <Badge tone="neutral" size="sm">
                        Severity: {item.severityNote}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{item.interpretation}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------- Document findings ---- */}
      {result.documentFindings.length > 0 ? (
        <section aria-labelledby="documents-heading" className="scroll-mt-24">
          <SectionHeading
            id="documents-heading"
            icon={FileWarning}
            title="Your documents"
            description="Transcribed from the documents you uploaded. Values are reproduced exactly as printed in the source; nothing was inferred."
            tag="extracted_from_document"
          />
          <Card variant="glass">
            <ul className="space-y-3">
              {result.documentFindings.map((finding, index) => (
                <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                  {finding}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {/* ------------------------------------------------- Imaging ------- */}
      {result.imagingObservations.length > 0 ? (
        <section aria-labelledby="imaging-heading" className="scroll-mt-24">
          <SectionHeading
            id="imaging-heading"
            icon={Sparkles}
            title="Imaging"
            description="AI-generated descriptions of what appeared to be visible in the uploaded image. These are not radiological interpretations."
            tag="ai_generated_interpretation"
          />
          <Card variant="glass" className="border-accent/25">
            <ul className="space-y-3">
              {result.imagingObservations.map((observation, index) => (
                <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  {observation}
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-subtle">
              <Stethoscope className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Only a qualified healthcare professional with the original study can interpret an image
              reliably.
            </p>
          </Card>
        </section>
      ) : null}

      {/* --------------------------------------------- Next steps --------- */}
      {result.recommendedNextSteps.length > 0 ? (
        <section aria-labelledby="steps-heading" className="scroll-mt-24">
          <SectionHeading
            id="steps-heading"
            icon={ArrowRight}
            title="Recommended next steps"
            description="What to do, not what to take. MedAssist AI does not prescribe, recommend or dose any medication."
            tag="recommended_next_step"
          />

          <ol className="space-y-3">
            {result.recommendedNextSteps.map((step, index) => {
              const meta = TIMELINE_META[step.timeframe];
              return (
                <li key={index}>
                  <Card variant="glass" className="h-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone as "critical" | "caution" | "good"} size="sm">
                        {meta.label}
                      </Badge>
                      <Badge tone="neutral" size="sm">
                        {CATEGORY_LABEL[step.category]}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-ink">{step.step}</p>
                    {step.rationale ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">{step.rationale}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {/* ---------------------------------------- Questions for clinician -- */}
      {result.questionsForClinician.length > 0 ? (
        <section aria-labelledby="questions-heading" className="scroll-mt-24">
          <SectionHeading
            id="questions-heading"
            icon={MessageCircleQuestion}
            title="Questions to discuss with a healthcare professional"
            description="These are suggestions for you to ask. They are not instructions to a clinician."
          />
          <Card variant="glass" className="border-brand/20">
            <ol className="space-y-3">
              {result.questionsForClinician.map((question, index) => (
                <li key={index} className="flex gap-3 text-sm leading-relaxed text-ink">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-xs font-semibold tabular-nums text-brand"
                  >
                    {index + 1}
                  </span>
                  {question}
                </li>
              ))}
            </ol>
          </Card>
        </section>
      ) : null}

      {/* ------------------------------------------ Evidence & gaps ------- */}
      <section aria-labelledby="evidence-heading" className="scroll-mt-24">
        <SectionHeading
          id="evidence-heading"
          icon={Info}
          title="What informed this assessment"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Card variant="glass">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
              Information used
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {result.evidenceUsed.map((item, index) => (
                <li key={index}>
                  <Badge tone="brand" size="sm">
                    {item}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="glass">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
              Not available
            </p>
            {result.missingInformation.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {result.missingInformation.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">Nothing significant was missing.</p>
            )}
          </Card>
        </div>
      </section>

      {/* --------------------------------------------- Limitations -------- */}
      <section aria-labelledby="limitations-heading" className="scroll-mt-24">
        <SectionHeading
          id="limitations-heading"
          icon={FileWarning}
          title="Limitations of this assessment"
          description="Always shown, and never optional."
        />
        <Card variant="glass" className="border-caution/25 bg-caution-soft/25">
          <ul className="space-y-2.5">
            {result.limitations.map((limitation, index) => (
              <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-caution" aria-hidden="true" />
                {limitation}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

export type { UrgencyLevel };