"use client";

import * as React from "react";
import Link from "next/link";
import { Link2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UrgencyBadge } from "@/components/ui/badge";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { ReportActions } from "@/components/reports/report-actions";
import type { StoredAnalysis } from "@/types/assessment";

export function SharedReportView({
  title,
  createdAt,
  analysis,
  shareUrl,
}: {
  title: string;
  createdAt: string;
  analysis: StoredAnalysis;
  shareUrl: string;
}) {
  const copyLink = async () => {
    const absolute = `${window.location.origin}${shareUrl}`;
    try {
      await navigator.clipboard.writeText(absolute);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">Read-only shared view</Badge>
          <Badge tone="caution">Owner only</Badge>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          Generated{" "}
          {new Date(createdAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </header>

      <Card variant="glass" padding="sm" className="no-print">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted">
            This link is only visible while you are signed in to the account that created it.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
            <Link2 className="size-3.5" aria-hidden="true" />
            Copy link
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" aria-hidden="true" />
            Print
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/assessments/${analysis.assessmentId}`}>Open assessment</Link>
          </Button>
        </div>
      </Card>

      <div className="glass-strong rounded-3xl p-5 sm:p-7">
        <p className="eyebrow">Overall summary</p>
        <p className="mt-3 text-pretty text-base leading-relaxed text-ink">
          {analysis.result.summary}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <UrgencyBadge level={analysis.result.urgency.level} size="sm" />
          {analysis.triage.escalated ? (
            <Badge tone="caution" size="sm">
              Raised by safety rules
            </Badge>
          ) : null}
        </div>
      </div>

      <ReportActions analysis={analysis} />

      <MedicalDisclaimer variant="card" />
    </div>
  );
}