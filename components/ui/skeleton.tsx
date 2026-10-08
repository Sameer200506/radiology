import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton", className)} {...props} />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="glass rounded-3xl p-5">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            className="h-3"
            style={{ width: `${[92, 78, 85, 60][index % 4]}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AssessmentCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading assessments</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="glass rounded-2xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass-subtle flex flex-col items-center justify-center rounded-3xl px-6 py-14 text-center",
        className,
      )}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-2xl bg-brand/15 blur-2xl" aria-hidden="true" />
        <div className="flex size-14 items-center justify-center rounded-2xl border border-brand/20 bg-brand/8">
          <Icon className="size-6 text-brand" />
        </div>
      </div>
      <h3 className="mt-5 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}