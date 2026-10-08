"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  FileDown,
  Loader2,
  Link2,
  MessageCircleQuestion,
  Printer,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api/client";
import { saveReport } from "@/lib/data";
import { buildReportPdf, downloadBlob } from "@/components/reports/pdf";
import type { ReportDocument } from "@/lib/ai/prompts/report";
import type { StoredAnalysis } from "@/types/assessment";

type AnalysisPayload = Pick<
  StoredAnalysis,
  "result" | "triage" | "caseData" | "audit" | "assessmentId"
>;


interface ReportResponse {
  report: ReportDocument;
  brief?: {
    headline: string;
    chronology: string;
    keyPoints: string[];
    openQuestions: string[];
  } | null;
  briefError?: string;
  reportId: string | null;
}

/**
 * Report controls: print, download as PDF, generate the printable view, and the
 * optional practitioner brief.
 *
 * Every action here is real. There is no placeholder button.
 */
export type ReportActionsProps = { analysis: AnalysisPayload; userId?: string };

export function ReportActions({
  analysis,
  userId,
}: ReportActionsProps) {
  const result = analysis.result;
  const assessmentId = analysis.assessmentId;
  const [report, setReport] = React.useState<ReportDocument | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [briefOpen, setBriefOpen] = React.useState(false);
  const [brief, setBrief] = React.useState<NonNullable<ReportResponse["brief"]> | null>(null);
  const [briefError, setBriefError] = React.useState<string | null>(null);
  const [briefBusy, setBriefBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const ensureReport = React.useCallback(
    async (options: { save?: boolean; withBrief?: boolean } = {}): Promise<ReportDocument | null> => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.post<ReportResponse>("/api/ai/report", {
          result: analysis.result,
          triage: analysis.triage,
          caseData: analysis.caseData,
          audit: analysis.audit.assessment ?? undefined,
          title: "MedAssist AI — Health Information Assessment",
          ...options,
        });

// Save through the client SDK so the report appears in the dashboard.
        // Printing and downloading each produce a record, which is what the
        // dashboard lists.
        if (userId && options.save) {
          await saveReport(userId, assessmentId, response.report.title);
        }

        setReport(response.report);
        if (response.brief) setBrief(response.brief);
        if (response.briefError) setBriefError(response.briefError);
        return response.report;
      } catch (requestError) {
        setError(errorMessage(requestError, "The report could not be generated."));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [analysis, assessmentId, userId],
  );

  const handlePrint = async () => {
    const reportDocument = report ?? (await ensureReport({ save: true }));
    if (!reportDocument) return;

    // The printable container is hidden on screen and revealed only for the print
    // dialog, so the printed output is the report rather than the app chrome.
    const container = window.document.getElementById("printable-report");
    container?.classList.remove("hidden");

    window.print();
    // Restore the hidden state after the print dialog closes.
    window.setTimeout(() => container?.classList.add("hidden"), 800);
  };

  const handleDownload = async () => {
    setGenerating(true);
    setError(null);
    try {
      const reportDocument = report ?? (await ensureReport({ save: true }));
      if (!reportDocument) return;

      const blob = await buildReportPdf(reportDocument);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `medassist-assessment-${stamp}.pdf`);
      toast.success("Report downloaded", {
        description: "Check the file before sharing it with a clinician.",
      });
    } catch (pdfError) {
      setError(errorMessage(pdfError, "The PDF could not be created."));
      toast.error("PDF generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleBrief = async () => {
    setBriefOpen(true);
    if (brief || briefBusy) return;

    setBriefBusy(true);
    setBriefError(null);
    try {
      const response = await api.post<ReportResponse>("/api/ai/report", {
        result: analysis.result,
        triage: analysis.triage,
        caseData: analysis.caseData,
        audit: analysis.audit.assessment ?? undefined,
        withBrief: true,
      });
      setBrief(response.brief ?? null);
      if (response.briefError) setBriefError(response.briefError);
    } catch (briefRequestError) {
      setBriefError(errorMessage(briefRequestError, "The brief could not be generated."));
    } finally {
      setBriefBusy(false);
    }
  };

  const handleCopyBrief = async () => {
    if (!brief) return;
    const text = [
      brief.headline,
      "",
      brief.chronology,
      "",
      "Key points:",
      ...brief.keyPoints.map((point) => `• ${point}`),
      "",
      "Questions to ask:",
      ...brief.openQuestions.map((question) => `• ${question}`),
      "",
      "Generated by MedAssist AI — AI decision support, not a diagnosis.",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  return (
    <div className="no-print space-y-3">
      <Card variant="glass" padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-medium text-ink">Report</p>

          <Button variant="secondary" size="sm" onClick={() => void handlePrint()} loading={loading}>
            <Printer className="size-3.5" aria-hidden="true" />
            Print
          </Button>

          <Button variant="secondary" size="sm" onClick={() => void handleDownload()} loading={generating}>
            <FileDown className="size-3.5" aria-hidden="true" />
            Download PDF
          </Button>

          <Button variant="secondary" size="sm" onClick={() => void handleBrief()}>
            <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
            Appointment brief
          </Button>

          <Button asChild variant="ghost" size="sm">
            <Link href={userId ? "/dashboard/reports" : "/"}>
              <Link2 className="size-3.5" aria-hidden="true" />
              Saved reports
            </Link>
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-subtle">
          The downloaded PDF reproduces the assessment exactly as shown above, including the
          disclaimer and provenance. Check it before sharing.
        </p>
      </Card>

      {/* Printable rendering, hidden on screen and shown only by the print dialog. */}
      <PrintableReport report={report} result={result} />

      <Dialog open={briefOpen} onOpenChange={setBriefOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Appointment brief</DialogTitle>
            <DialogDescription>
              A short version you can read out or hand to a clinician. It restates your own account —
              it is not a clinical summary written by a professional.
            </DialogDescription>
          </DialogHeader>

          {briefBusy ? (
            <div className="mt-6 space-y-3" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin text-brand" aria-hidden="true" />
                Writing the brief…
              </p>
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ) : briefError ? (
            <div className="mt-6 space-y-4" role="alert">
              <p className="text-sm leading-relaxed text-ink">{briefError}</p>
              <Button variant="secondary" size="sm" onClick={() => void handleBrief()}>
                Try again
              </Button>
            </div>
          ) : brief ? (
            <div className="mt-6 space-y-5">
              <section>
                <p className="eyebrow">In one line</p>
                <p className="mt-2 text-sm leading-relaxed text-ink">{brief.headline}</p>
              </section>

              <section>
                <p className="eyebrow">Time course</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{brief.chronology}</p>
              </section>

              <section>
                <p className="eyebrow">Key points</p>
                <ul className="mt-2 space-y-2">
                  {brief.keyPoints.map((point, index) => (
                    <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                      <span aria-hidden="true" className="text-brand">•</span>
                      {point}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="eyebrow">Questions to ask</p>
                <ol className="mt-2 space-y-2">
                  {brief.openQuestions.map((question, index) => (
                    <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                      <span
                        aria-hidden="true"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/12 text-[0.625rem] font-semibold tabular-nums text-brand"
                      >
                        {index + 1}
                      </span>
                      {question}
                    </li>
                  ))}
                </ol>
              </section>

              <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row">
                <Button size="sm" onClick={() => void handleCopyBrief()}>
                  {copied ? (
                    <>
                      <Check className="size-3.5" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" aria-hidden="true" />
                      Copy brief
                    </>
                  )}
                </Button>
                <Button asChild variant="secondary" size="sm" className="sm:ml-auto">
                  <Link href={`/dashboard/assessments/${assessmentId}`}>View full assessment</Link>
                </Button>
              </div>

              <p className="text-xs leading-relaxed text-subtle">
                AI-generated. Not a diagnosis, and not a substitute for a clinician&apos;s own
                assessment.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Print-only rendering of the report.
 *
 * Uses the same document builder as the PDF, so print and download can never
 * disagree with each other.
 */
function PrintableReport({
  report,
  result,
}: {
  report: ReportDocument | null;
  result: StoredAnalysis["result"];
}) {
  const sections: ReportDocument["sections"] = report
    ? report.sections
    : [
        {
          id: "summary",
          title: "Overall Summary",
          paragraphs: [result.summary],
          bullets: [],
        },
      ];

  return (
    <div id="printable-report" className="hidden">
      <div className="bg-white p-8 text-ink">
        <div className="mx-auto max-w-3xl">
          <header className="border-b border-line pb-4">
            <p className="text-lg font-semibold text-ink">
              {report?.title ?? "MedAssist AI — Health Information Assessment"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {report?.subtitle ?? "AI-Assisted Health Assessment"}
            </p>
            <p className="mt-1 text-xs text-subtle">
              Generated {new Date().toLocaleString()}
            </p>
          </header>

          <div className="my-5 rounded-lg border border-caution/40 bg-caution-soft/40 p-3">
            <p className="text-xs leading-relaxed">
              {report?.disclaimer ??
                "This document was generated by an automated decision-support tool from user-supplied information. It is not a diagnosis and must be verified by a qualified healthcare professional."}
            </p>
          </div>

          {sections.map((section) => (
            <section key={section.id} className="mb-6">
              <h2 className="text-base font-semibold text-ink">{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="mt-2 text-sm leading-relaxed text-muted">
                  {paragraph}
                </p>
              ))}
              {section.bullets.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {section.bullets.map((bullet, index) => (
                    <li key={index} className="flex gap-2 text-sm leading-relaxed text-muted">
                      <span aria-hidden="true" className="text-brand">•</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <footer className="mt-8 border-t border-line pt-3">
            <p className="text-[0.6875rem] leading-relaxed text-subtle">
              MedAssist AI — AI-generated decision support, not a diagnosis. Urgency level:{" "}
              {result.urgency.level.replace(/_/g, " ")}.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
