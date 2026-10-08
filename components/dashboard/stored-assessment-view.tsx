"use client";

import * as React from "react";
import { FileText, PlayCircle, ShieldCheck, Sparkles } from "lucide-react";

import { Badge, UrgencyBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { ResultsView } from "@/components/medical/results-view";
import { EmergencyBanner } from "@/components/medical/emergency-banner";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { ReportActions } from "@/components/reports/report-actions";
import { StatusBadge } from "@/components/dashboard/dashboard-view";
import { formatBytes } from "@/lib/security/upload-policy";
import type { AssessmentSummary, StoredAnalysis } from "@/types/assessment";
import type { MedicalCase, UrgencyLevel } from "@/types/medical";

type AssessmentMeta = Omit<AssessmentSummary, "urgency"> & { urgency: UrgencyLevel | null };

export function StoredAssessmentView({
  assessment,
  userId,
  caseData,
  uploads,
  analysis,
}: {
  assessment: AssessmentMeta;
  userId: string | undefined;
  caseData: MedicalCase;
  uploads: Array<{
    id: string;
    displayName: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    kind: string;
    status: string;
    characterCount: number;
    pageCount: number;
    textExtracted: boolean;
  }>;
  analysis: StoredAnalysis | null;
}) {
  const result = analysis?.result ?? null;

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">
          {new Date(assessment.createdAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{assessment.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{assessment.symptomSummary}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={assessment.status} />
          {assessment.urgency ? <UrgencyBadge level={assessment.urgency} size="sm" /> : null}
          {assessment.isDemo ? (
            <Badge tone="accent" size="sm">
              Synthetic demo
            </Badge>
          ) : null}
        </div>
      </header>

      {result?.urgency.level === "EMERGENCY" ? (
        <EmergencyBanner
          triage={{
            level: "EMERGENCY",
            emergencyNotice:
              "Contact your local emergency number or go to the nearest emergency department now. Do not wait for or rely on this assessment.",
          }}
        />
      ) : null}

      {/* What the user provided */}
      <Card variant="glass" padding="md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">What you provided</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Symptoms</p>
            <ul className="mt-2 space-y-1.5">
              {caseData.symptoms.length > 0 ? (
                caseData.symptoms.map((symptom, index) => (
                  <li key={index} className="text-sm text-muted">
                    <span className="font-medium text-ink">{symptom.name}</span>
                    {symptom.duration ? ` · ${symptom.duration}` : ""}
                    {symptom.severity ? ` · ${symptom.severity}` : ""}
                  </li>
                ))
              ) : (
                <li className="text-sm text-subtle">None recorded</li>
              )}
            </ul>
          </div>

          <div>
            <p className="eyebrow">Answers</p>
            {caseData.answers.length > 0 ? (
              <dl className="mt-2 space-y-2">
                {caseData.answers.slice(0, 6).map((answer, index) => (
                  <div key={index}>
                    <dt className="text-xs text-subtle">{answer.question}</dt>
                    <dd className="text-sm text-muted">{answer.answer}</dd>
                  </div>
                ))}
                {caseData.answers.length > 6 ? (
                  <li className="text-xs text-subtle">
                    + {caseData.answers.length - 6} more
                  </li>
                ) : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-subtle">None recorded</p>
            )}
          </div>
        </div>

        {caseData.freeText ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="eyebrow">Your description</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {caseData.freeText}
            </p>
          </div>
        ) : null}
      </Card>

      {/* Uploads */}
      <section aria-labelledby="stored-uploads">
        <h2 id="stored-uploads" className="mb-3 text-sm font-semibold tracking-tight text-ink">
          Uploaded files ({uploads.length})
        </h2>

        {uploads.length === 0 ? (
          <Card variant="glass-subtle" padding="sm">
            <p className="text-sm text-muted">No documents were uploaded to this assessment.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {uploads.map((upload) => (
              <li
                key={upload.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/50 px-4 py-3"
              >
                <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{upload.displayName}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {formatBytes(upload.sizeBytes)}
                    {upload.textExtracted
                      ? ` · ${upload.pageCount} page(s) · ${upload.characterCount.toLocaleString()} characters read`
                      : " · no readable text layer"}
                  </p>
                </div>
                <Badge tone={upload.status === "analyzed" ? "good" : "neutral"} size="sm">
                  {upload.status === "analyzed" ? "Analysed" : "Uploaded"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Result */}
      {result && analysis ? (
        <>
          <div className="glass-strong rounded-3xl p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">Overall summary</p>
              {analysis.triage.escalated ? (
                <Badge tone="caution" size="sm">
                  Urgency raised by safety rules
                </Badge>
              ) : null}
            </div>
            <p className="mt-3 text-pretty text-base leading-relaxed text-ink">{result.summary}</p>
          </div>

          <ReportActions analysis={analysis} userId={userId} />

          <ResultsView result={result} />

          <ProvenanceCard analysis={analysis} />
        </>
      ) : (
        <EmptyState
          icon={PlayCircle}
          title="This assessment has not been analysed yet"
          description="Run the analysis to generate a structured summary of what you provided. You will need to continue the assessment to do that."
        />
      )}

      <MedicalDisclaimer variant="card" />
    </div>
  );
}

/** Audit trail shown after the result: what decided it, and with what. */
function ProvenanceCard({ analysis }: { analysis: StoredAnalysis }) {
  const audit = analysis.audit;
  const entries = Object.entries(audit).filter(
    (entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]),
  ) as Array<[string, NonNullable<(typeof audit)[keyof typeof audit]>]>;

  return (
    <Card variant="glass" padding="md" className="no-print">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          How this assessment was produced
        </h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="eyebrow">Deterministic safety layer</p>
          <p className="mt-1.5 text-sm text-muted">
            Rules triggered:{" "}
            {analysis.triage.firedRules.length > 0 ? analysis.triage.firedRules.join(", ") : "none"}
          </p>
          <p className="mt-1 text-sm text-muted">
            Urgency raised above the AI suggestion:{" "}
            {analysis.triage.escalated ? "yes" : "no"}
          </p>
        </div>

        <div>
          <p className="eyebrow">Model calls</p>
          <ul className="mt-1.5 space-y-1.5">
            {entries.length === 0 ? (
              <li className="text-sm text-subtle">No audit metadata was stored.</li>
            ) : (
              entries.map(([stage, meta]) => {
                const record = meta as {
                  model?: string;
                  promptVersion?: string;
                  latencyMs?: number;
                  usedFallback?: boolean;
                  repairAttempted?: boolean;
                };
                return (
                  <li key={stage} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                    <Sparkles className="mt-0.5 size-3 shrink-0 text-subtle" aria-hidden="true" />
                    <span>
                      <span className="font-medium text-ink">{stage}</span> · {record.model ?? "unknown"}{" "}
                      · prompt {record.promptVersion ?? "unknown"}
                      {record.latencyMs ? ` · ${(record.latencyMs / 1000).toFixed(1)}s` : ""}
                      {record.usedFallback ? " · fallback model" : ""}
                      {record.repairAttempted ? " · repaired" : ""}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
}