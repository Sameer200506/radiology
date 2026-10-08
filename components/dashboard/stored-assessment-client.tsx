"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StoredAssessmentView } from "@/components/dashboard/stored-assessment-view";
import { useAuth } from "@/components/auth/auth-provider";
import { getAssessment, getLatestAnalysis, listUploads } from "@/lib/data";
import type { StoredAnalysis } from "@/types/assessment";
import type { AssessmentDoc } from "@/types/firebase";
import type { UploadRecord } from "@/types/firebase";

/**
 * Stored assessment detail.
 *
 * Reads Firestore directly from the browser — the Security Rules decide what is
 * visible — which is why this is a Client Component rather than a Server
 * Component. A Server Component cannot use the client SDK, and using the Admin
 * SDK here would reintroduce the service-account requirement.
 */
export function StoredAssessmentClient({ assessmentId }: { assessmentId: string }) {
  const { user, ready } = useAuth();
  const [assessment, setAssessment] = React.useState<AssessmentDoc | null>(null);
  const [uploads, setUploads] = React.useState<UploadRecord[]>([]);
  const [analysis, setAnalysis] = React.useState<StoredAnalysis | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ready) return;
    if (!user) {
      setState("error");
      setError("Please sign in to view this assessment.");
      return;
    }

    let active = true;

    const load = async () => {
      try {
        const record = await getAssessment(user.uid, assessmentId);
        if (!active) return;

        if (!record) {
          // 404-equivalent: never confirm that someone else's record exists.
          setState("missing");
          return;
        }

        setAssessment(record);
        const [uploadList, latest] = await Promise.all([
          listUploads(user.uid, assessmentId),
          getLatestAnalysis(user.uid, assessmentId),
        ]);
        if (!active) return;
        setUploads(uploadList);
        setAnalysis(latest);
        setState("ready");
      } catch (loadError) {
        if (!active) return;
        setState("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "That assessment could not be loaded. It may have been deleted, or the database rules may not be deployed yet.",
        );
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, ready, assessmentId]);

  if (state === "loading") {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <span className="sr-only">Loading assessment</span>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  if (state === "missing") {
    return (
      <Card variant="glass" padding="lg" className="text-center">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Assessment not found</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          That assessment does not exist, or it belongs to a different account.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard/assessments">View my assessments</Link>
        </Button>
      </Card>
    );
  }

  if (state === "error" || !assessment) {
    return (
      <Card variant="glass" padding="lg" className="border-critical/30">
        <p role="alert" className="flex items-start gap-2 text-sm leading-relaxed text-ink">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
          {error ?? "Something went wrong."}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          If this persists, check that Firestore Security Rules are deployed with{" "}
          <code className="font-mono">firebase deploy --only firestore:rules</code>.
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link href="/dashboard/assessments">Back to assessments</Link>
        </Button>
      </Card>
    );
  }

  return (
    <StoredAssessmentView
      userId={user?.uid}
      assessment={{
        id: assessment.id,
        title: assessment.title,
        symptomSummary: assessment.symptomSummary,
        status: assessment.status,
        urgency: assessment.urgency,
        fileCount: assessment.fileCount,
        isDemo: assessment.isDemo,
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt,
      }}
      caseData={assessment.caseData}
      uploads={uploads}
      analysis={analysis}
    />
  );
}