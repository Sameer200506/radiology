"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Link2, Share2, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AssessmentCardSkeleton, EmptyState } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api/client";
import { deleteReport, listReports, setReportSharing } from "@/lib/data";
import { useAuth } from "@/components/auth/auth-provider";

interface ReportRow {
  id: string;
  assessmentId: string;
  title: string;
  createdAt: string;
  shareEnabled: boolean;
shareId: string | null;
}

export function ReportsListView() {
  const { user, ready } = useAuth();
  const [reports, setReports] = React.useState<ReportRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ReportRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

const load = React.useCallback(async () => {
    try {
      if (!user) return;
      const rows = await listReports(50);
      setReports(rows.map((row) => ({ ...row })));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, "Your reports could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [user]);

React.useEffect(() => {
    if (!ready) return;
void load();
  }, [load, ready]);

  const toggleShare = async (report: ReportRow) => {
    try {
      const updated = await setReportSharing(report.id, !report.shareEnabled);

      setReports((current) =>
        current.map((item) =>
          item.id === report.id
            ? { ...item, shareEnabled: updated?.shareEnabled ?? false, shareId: updated?.shareId ?? null }
            : item,
        ),
      );

      const shareId = updated?.shareId ?? null;
      if (shareId) {
        const absolute = `${window.location.origin}/share/${shareId}`;
        try {
          await navigator.clipboard.writeText(absolute);
          toast.success("Share link copied", { description: "Anyone with the link can read this report." });
        } catch {
          toast.success("Share link created", { description: absolute });
        }
      } else {
        toast.success("Sharing disabled");
      }
    } catch (shareError) {
      toast.error(errorMessage(shareError, "Sharing could not be changed."));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteReport(pendingDelete.id);
      setReports((current) => current.filter((item) => item.id !== pendingDelete.id));
      toast.success("Report removed");
      setPendingDelete(null);
    } catch (deleteError) {
      toast.error(errorMessage(deleteError, "The report could not be removed."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Reports</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Saved reports</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          A report is generated when you download a PDF or print an assessment. Sharing creates a
          read-only link — turn it off whenever you like.
        </p>
      </header>

      {error ? (
        <Card variant="glass" className="border-critical/30">
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        </Card>
      ) : null}

      {loading ? (
        <AssessmentCardSkeleton count={3} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description="Complete an assessment and download the PDF, or use Print. The report is then listed here and can be shared as a read-only link."
          action={
            <Button asChild>
              <Link href="/assessment/new">Start an assessment</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id}>
              <Card variant="glass" padding="sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                      <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
                      <span className="truncate">{report.title}</span>
                    </p>
                    <p className="mt-1 text-xs text-subtle">
                      {new Date(report.createdAt).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  {report.shareEnabled ? (
                    <Badge tone="caution" size="sm">
                      Shared publicly via link
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/dashboard/assessments/${report.assessmentId}`}>Open assessment</Link>
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void toggleShare(report)}
                  >
                    {report.shareEnabled ? (
                      <>
                        <Undo2 className="size-3.5" aria-hidden="true" />
                        Stop sharing
                      </>
                    ) : (
                      <>
                        <Share2 className="size-3.5" aria-hidden="true" />
                        Share read-only
                      </>
                    )}
                  </Button>

                  {report.shareEnabled && report.shareId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(`${window.location.origin}/share/${report.shareId as string}`)
                          .then(() => toast.success("Link copied"))
                          .catch(() => toast.error("Could not copy the link"))
                      }
                    >
                      <Link2 className="size-3.5" aria-hidden="true" />
                      Copy link
                    </Button>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-critical hover:bg-critical/10 hover:text-critical"
                    onClick={() => setPendingDelete(report)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this report?</DialogTitle>
            <DialogDescription>
              The report record is removed. If it is currently shared, the link stops working
              immediately. The underlying assessment is not affected.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={deleting}>
              Remove report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}