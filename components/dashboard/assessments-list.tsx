"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Filter, PlusCircle, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AssessmentCardSkeleton, EmptyState } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssessmentCard } from "@/components/dashboard/dashboard-view";
import { errorMessage } from "@/lib/api/client";
import { deleteAssessment, listAssessments, writeAuditLog } from "@/lib/data";
import { useAuth } from "@/components/auth/auth-provider";
import { URGENCY_LEVELS, type UrgencyLevel } from "@/types/medical";
import type { AssessmentStatus, AssessmentSummary } from "@/types/assessment";

const STATUSES: AssessmentStatus[] = ["draft", "in_progress", "analyzing", "complete", "failed"];
const PAGE_SIZE = 12;

export function AssessmentsListView() {
  const searchParams = useSearchParams();
  const { user, ready } = useAuth();
  const [items, setItems] = React.useState<AssessmentSummary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [status, setStatus] = React.useState<AssessmentStatus | "">(
    (searchParams.get("status") as AssessmentStatus | null) ?? "",
  );
  const [urgency, setUrgency] = React.useState<UrgencyLevel | "">(
    (searchParams.get("urgency") as UrgencyLevel | null) ?? "",
  );
  const [query, setQuery] = React.useState("");

  const [pendingDelete, setPendingDelete] = React.useState<AssessmentSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const fetchPage = React.useCallback(
    async (nextCursor?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        if (!user) return;

        // Firestore, scoped by the Security Rules to the signed-in user.
        const response = await listAssessments(user.uid, {
          limit: PAGE_SIZE,
          ...(nextCursor ? { cursor: nextCursor } : {}),
          ...(status ? { status } : {}),
          ...(urgency ? { urgency } : {}),
        });

        setItems((current) => (append ? [...current, ...response.items] : response.items));
        setCursor(response.nextCursor);
        setHasMore(response.hasMore);
        setError(null);
      } catch (loadError) {
        setError(errorMessage(loadError, "Your assessments could not be loaded."));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [user, status, urgency],
  );

  React.useEffect(() => {
    if (!ready) return;
    void fetchPage();
  }, [fetchPage, ready]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.title} ${item.symptomSummary}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (!user) return;
      await deleteAssessment(user.uid, pendingDelete.id);
      void writeAuditLog({
        action: "assessment_deleted",
        resourceType: "assessment",
        resourceId: pendingDelete.id,
      });
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      toast.success("Assessment deleted", {
        description: "The assessment and its uploaded files have been removed.",
      });
      setPendingDelete(null);
    } catch (deleteError) {
      toast.error(errorMessage(deleteError, "The assessment could not be deleted."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">History</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">My assessments</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Every assessment is private to your account. Deleting one removes its uploads too.
          </p>
        </div>
        <Button asChild>
          <Link href="/assessment/new">
            <PlusCircle className="size-4" aria-hidden="true" />
            New assessment
          </Link>
        </Button>
      </header>

      <Card variant="glass" padding="sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <label htmlFor="search" className="text-xs font-medium text-ink">
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                aria-hidden="true"
              />
              <Input
                id="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this page"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="status-filter" className="text-xs font-medium text-ink">
              Status
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value as AssessmentStatus | "")}
              className="h-11 rounded-xl border border-line bg-surface/70 px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/12"
            >
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="urgency-filter" className="text-xs font-medium text-ink">
              Urgency
            </label>
            <select
              id="urgency-filter"
              value={urgency}
              onChange={(event) => setUrgency(event.target.value as UrgencyLevel | "")}
              className="h-11 rounded-xl border border-line bg-surface/70 px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/12"
            >
              <option value="">All levels</option>
              {URGENCY_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error ? (
        <Card variant="glass" className="border-critical/30">
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        </Card>
      ) : null}

      {loading ? (
        <AssessmentCardSkeleton count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={items.length === 0 ? "No assessments yet" : "Nothing matches those filters"}
          description={
            items.length === 0
              ? "Start an assessment and it will appear here with its urgency level, files and report."
              : "Try clearing the search box or the filters above."
          }
          action={
            items.length === 0 ? (
              <Button asChild>
                <Link href="/assessment/new">Start an assessment</Link>
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setUrgency("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {filtered.map((item) => (
              <li key={item.id} className="group relative">
                <AssessmentCard item={item} />
                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  className="absolute right-3 top-3 rounded-full bg-surface/90 p-2 text-subtle opacity-0 transition-all hover:bg-critical/10 hover:text-critical focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand group-hover:opacity-100"
                  aria-label={`Delete assessment: ${item.title}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                onClick={() => void fetchPage(cursor ?? undefined, true)}
                loading={loadingMore}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this assessment?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and every file uploaded to it will be permanently
              removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone="neutral" size="sm">
              {pendingDelete?.fileCount ?? 0} file(s) will be deleted
            </Badge>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}