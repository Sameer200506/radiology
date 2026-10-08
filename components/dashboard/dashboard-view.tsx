"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FileText,
  Flame,
  Paperclip,
  PlusCircle,
  TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Badge, UrgencyBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AssessmentCardSkeleton, EmptyState } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api/client";
import { listAssessments, listReports } from "@/lib/data";
import { urgencyPresentation } from "@/lib/medical/urgency";
import type { AssessmentSummary } from "@/types/assessment";
import type { UrgencyLevel } from "@/types/medical";

interface DashboardData {
  assessments: AssessmentSummary[];
  counts: {
    total: number;
    complete: number;
    pendingReviews: number;
    urgentOrEmergency: number;
    reports: number;
    uploads: number;
    flaggedForReview: number;
  };
  recentUrgency: Array<{ date: string; level: UrgencyLevel }>;
}

export function DashboardView() {
  const { user, ready } = useAuth();
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ready || !user) {
      setLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      try {
        const uid = user?.uid;
        if (!uid) {
          if (active) setData(null);
          return;
        }

        // Firestore reads happen in the browser, scoped by Security Rules.
        const [assessments, reports] = await Promise.all([
          listAssessments(uid, { limit: 20 }),
          listReports(50),
        ]);

        const items = assessments.items;

        // Uploads per assessment are already denormalised on the doc, so the
        // dashboard needs no extra requests.
        const uploads = items.reduce((sum, item) => sum + (item.fileCount ?? 0), 0);

        const urgent = items.filter(
          (item) => item.urgency === "URGENT" || item.urgency === "EMERGENCY",
        ).length;

        const recentUrgency = [...items]
          .filter((item) => item.urgency !== null)
          .slice(0, 12)
          .reverse()
          .map((item) => ({ date: item.updatedAt.slice(0, 10), level: item.urgency as UrgencyLevel }));

        if (active) {
          setData({
            assessments: items,
            counts: {
              total: items.length,
              complete: items.filter((item) => item.status === "complete").length,
              // "Pending review" means the person still has work outstanding:
              // either the assessment never finished, or it finished but has no
              // analysis yet. Both mean a result they have not read.
              pendingReviews: items.filter(
                (item) => item.status !== "complete" || item.urgency === null,
              ).length,
              urgentOrEmergency: urgent,
              reports: reports.length,
              uploads,
              flaggedForReview: urgent + items.filter((item) => item.status === "failed").length,
            },
            recentUrgency,
          });
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError, "The dashboard could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, ready]);

  const firstName = user?.displayName?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            A summary of your assessments. Urgency levels are indications from automated safety
            rules and AI review — always confirm with a healthcare professional.
          </p>
        </div>
        <Button asChild>
          <Link href="/assessment/new">
            <PlusCircle className="size-4" aria-hidden="true" />
            New assessment
          </Link>
        </Button>
      </header>

      {error ? (
        <Card variant="glass" className="border-critical/30">
          <p role="alert" className="text-sm leading-relaxed text-ink">
            {error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Card>
      ) : null}

      {/* Stats */}
      <section aria-label="Overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="skeleton h-28 rounded-3xl" />
            ))
          : (
              <>
                <StatCard
                  icon={Activity}
                  label="Recent assessments"
                  value={data?.counts.total ?? 0}
                  href="/dashboard/assessments"
                  tone="brand"
                  hint="Across all of your assessments"
                />
                <StatCard
                  icon={CheckCircle2}
                  label="Pending reviews"
                  value={data?.counts.pendingReviews ?? 0}
                  href="/dashboard/assessments"
                  tone="caution"
                  hint="Still in progress, or not yet analysed"
                />
                <StatCard
                  icon={Flame}
                  label="Flagged for review"
                  value={data?.counts.flaggedForReview ?? 0}
                  href="/dashboard/assessments?urgency=URGENT"
                  tone="critical"
                  hint="Urgent or emergency urgency, or a failed run"
                />
                <StatCard
                  icon={Paperclip}
                  label="Uploads"
                  value={data?.counts.uploads ?? 0}
                  href="/dashboard/assessments"
                  tone="info"
                  hint="Files stored across your assessments"
                />
                <StatCard
                  icon={FileText}
                  label="Reports"
                  value={data?.counts.reports ?? 0}
                  href="/dashboard/reports"
                  tone="accent"
                  hint="Generated or printed from an assessment"
                />
              </>
            )}
      </section>

      {/* Trend */}
      {!loading && data && data.recentUrgency.length >= 3 ? (
        <Card variant="glass" padding="md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Urgency trend</p>
              <p className="mt-1 text-sm text-muted">
                The urgency level recorded for each completed assessment, most recent last.
              </p>
            </div>
            <TrendingUp className="size-4 text-subtle" aria-hidden="true" />
          </div>

          <div className="mt-5 h-36 w-full" role="img" aria-label="Urgency level over time">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.recentUrgency} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="urgencyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--subtle))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 4]}
                  ticks={[0, 1, 2, 3, 4]}
                  tick={{ fontSize: 10, fill: "hsl(var(--subtle))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) =>
                    ["Routine", "Non-urgent", "Prompt", "Urgent", "Emergency"][value] ?? ""
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const level = payload[0]?.payload?.level as UrgencyLevel | undefined;
                    return (
                      <div className="glass-strong rounded-xl px-3 py-2 text-xs">
                        <p className="font-medium text-ink">
                          {level ? level.replace(/_/g, " ") : "Unknown"}
                        </p>
                        <p className="text-subtle">{payload[0]?.payload?.date}</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={(entry: { level: UrgencyLevel }) =>
                    ["ROUTINE", "NON_URGENT", "PROMPT_MEDICAL_REVIEW", "URGENT", "EMERGENCY"].indexOf(
                      entry.level,
                    )
                  }
                  stroke="hsl(var(--brand))"
                  strokeWidth={2}
                  fill="url(#urgencyFill)"
                  dot={{ r: 3, fill: "hsl(var(--brand))", strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {/* Recent assessments */}
      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-heading" className="text-base font-semibold tracking-tight text-ink">
            Recent assessments
          </h2>
          <Link
            href="/dashboard/assessments"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:opacity-80"
          >
            View all
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        {loading ? (
          <AssessmentCardSkeleton count={3} />
        ) : data && data.assessments.length > 0 ? (
          <ul className="space-y-3">
            {data.assessments.slice(0, 5).map((item, index) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.05 }}
              >
                <AssessmentCard item={item} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={PlusCircle}
            title="No assessments yet"
            description="Start an assessment to get a structured summary of your symptoms and any documents you upload. You can try a synthetic demo first if you prefer."
            action={
              <Button asChild>
                <Link href="/assessment/new">Start your first assessment</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
  tone,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href: string;
  tone: "brand" | "good" | "critical" | "accent" | "caution" | "info";
  hint?: string;
}) {
  const tones = {
    brand: "bg-brand/10 text-brand",
    good: "bg-good/10 text-good",
    critical: "bg-critical/10 text-critical",
    accent: "bg-accent/10 text-accent",
    caution: "bg-caution/12 text-caution",
    info: "bg-info/12 text-info",
  } as const;

  return (
    <Link href={href} className="group">
      <Card variant="glass" hover="lift" className="h-full">
        <div className="flex items-start justify-between gap-3">
          <span className={cn("flex size-9 items-center justify-center rounded-xl", tones[tone])}>
            <Icon className="size-[1.05rem]" aria-hidden="true" />
          </span>
          <ArrowRight
            className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
        <p className="mt-4 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
        <p className="mt-0.5 text-sm text-muted">{label}</p>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p> : null}
      </Card>
    </Link>
  );
}

export function AssessmentCard({ item }: { item: AssessmentSummary }) {
  const presentation = item.urgency ? urgencyPresentation(item.urgency) : null;

  return (
    <Link href={`/dashboard/assessments/${item.id}`} className="group block">
      <Card variant="glass" hover="lift" padding="sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="truncate">{item.title}</span>
              {item.isDemo ? (
                <Badge tone="accent" size="sm">
                  Demo
                </Badge>
              ) : null}
            </p>
            <p className="mt-1 truncate text-sm text-muted">
              {item.symptomSummary || "No symptoms recorded"}
            </p>
            <p className="mt-1.5 text-xs text-subtle">
              {new Date(item.updatedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {item.urgency ? (
              <UrgencyBadge level={item.urgency} size="sm" />
            ) : (
              <Badge tone="neutral" size="sm">
                Not analysed
              </Badge>
            )}
            <StatusBadge status={item.status} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-xs text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Paperclip className="size-3" aria-hidden="true" />
            {item.fileCount} file{item.fileCount === 1 ? "" : "s"}
          </span>
          {presentation ? (
            <span className="truncate">{presentation.prose}</span>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

export function StatusBadge({ status }: { status: AssessmentSummary["status"] }) {
  const config = {
    draft: { tone: "neutral", label: "Draft" },
    in_progress: { tone: "info", label: "In progress" },
    analyzing: { tone: "info", label: "Analysing" },
    complete: { tone: "good", label: "Complete" },
    failed: { tone: "critical", label: "Failed" },
  }[status] as { tone: "neutral" | "info" | "good" | "critical"; label: string };

  return (
    <Badge tone={config.tone} size="sm">
      {config.label}
    </Badge>
  );
}