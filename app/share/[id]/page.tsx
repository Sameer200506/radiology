"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileQuestion, Lock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSharedReport } from "@/lib/data";
import { SharedReportView } from "@/components/reports/shared-report-view";
import type { ReportRecord } from "@/types/assessment";

/**
 * Public read-only view of a shared report.
 *
 * This page deliberately does NOT require a session. The share token in the URL
 * is the report document id, and `firestore.rules` permits a single `get` when
 * `shareEnabled` is true and `shareId` matches that id. Everything else about
 * the account — other assessments, uploads, raw case data — stays unreachable.
 *
 * It is a client component because the read itself happens in the browser
 * through the client SDK; there is no server-side credential to read with.
 */
export default function SharedReportPage() {
  const params = useParams<{ id: string }>();
  const shareId = typeof params?.id === "string" ? params.id : "";

  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "missing" }
    | {
        status: "ready";
        title: string;
        createdAt: string;
        analysis: NonNullable<ReportRecord["sharedAnalysis"]>;
      }
  >({ status: "loading" });

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      if (!shareId) {
        if (active) setState({ status: "missing" });
        return;
      }

      try {
        const report = await getSharedReport(shareId);
        if (!active) return;

        if (!report || !report.sharedAnalysis) {
          setState({ status: "missing" });
          return;
        }

        setState({
          status: "ready",
          title: report.title,
          createdAt: report.createdAt,
          analysis: report.sharedAnalysis,
        });
      } catch {
        // A permission error and a missing report are reported identically, so a
        // stranger cannot use the error to discover which tokens exist.
        if (active) setState({ status: "missing" });
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [shareId]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10" aria-busy="true" aria-live="polite">
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton h-40 w-full" />
        <span className="sr-only">Loading the shared report…</span>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-10">
        <Card variant="glass" padding="md">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            <Lock className="size-5 text-caution" aria-hidden="true" />
            This link is no longer available
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The report may have been unshared, or the link may have been copied incorrectly. Ask
            the person who shared it for a current link.
          </p>
          <Button asChild className="mt-6" variant="secondary">
            <Link href="/">Go to MedAssist AI</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <Card variant="glass" padding="sm">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-subtle">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This is a read-only copy shared by someone else. It contains health information and is
            visible to anyone with this link — do not forward it, and do not post it publicly.
          </span>
        </p>
      </Card>

      <SharedReportView
        title={state.title}
        createdAt={state.createdAt}
        analysis={state.analysis}
        shareUrl={`/share/${shareId}`}
      />

      <p className="flex items-center justify-center gap-2 text-xs text-subtle">
        <FileQuestion className="size-3.5" aria-hidden="true" />
        AI-generated decision support, not a diagnosis.
      </p>
    </div>
  );
}