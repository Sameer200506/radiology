import { cva, type VariantProps } from "class-variance-authority";
import { AlertOctagon, AlertTriangle, CalendarClock, Clock, Info } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { urgencyPresentation } from "@/lib/medical/urgency";
import type { UrgencyLevel } from "@/types/medical";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] backdrop-blur-md",
  {
    variants: {
      tone: {
        neutral: "border-line/90 bg-surface/45 text-muted",
        brand: "border-brand/25 bg-brand/10 text-brand",
        info: "border-info/25 bg-info/10 text-info",
        caution: "border-caution/30 bg-caution/10 text-caution",
        critical: "border-critical/30 bg-critical/10 text-critical",
        good: "border-good/25 bg-good/10 text-good",
        accent: "border-accent/25 bg-accent/10 text-accent",
      },
      size: {
        sm: "px-2 py-0.5 text-[0.625rem]",
        md: "",
        lg: "px-3.5 py-1.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/**
 * Urgency chip.
 *
 * Always renders the level as text plus an icon. Colour is decorative only, so
 * the information survives greyscale, colour blindness and screen readers.
 */
export function UrgencyBadge({
  level,
  size = "md",
  className,
}: {
  level: UrgencyLevel;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const presentation = urgencyPresentation(level);
  const Icon = presentation.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-[0.08em] backdrop-blur-md",
        presentation.chipClass,
        size === "lg" ? "px-3.5 py-1.5 text-xs" : "px-2.5 py-1 text-[0.6875rem]",
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-3.5" : "size-3"} aria-hidden="true" />
      <span>{presentation.label}</span>
    </span>
  );
}

/** Small dot+label used in dense lists. */
export function StatusDot({
  tone = "neutral",
  label,
}: {
  tone?: "brand" | "info" | "caution" | "critical" | "good" | "neutral";
  label: string;
}) {
  const dotClass = {
    brand: "bg-brand",
    info: "bg-info",
    caution: "bg-caution",
    critical: "bg-critical",
    good: "bg-good",
    neutral: "bg-subtle",
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Legend for the five urgency levels, used in help text and docs. */
export function urgencyLegend() {
  return (["ROUTINE", "NON_URGENT", "PROMPT_MEDICAL_REVIEW", "URGENT", "EMERGENCY"] as const).map(
    (level) => {
      const p = urgencyPresentation(level);
      const Icon = p.icon;
      return {
        level,
        label: p.label,
        description: p.description,
        icon: Icon as React.ComponentType<{ className?: string }>,
      };
    },
  );
}

export const urgencyIcons = {
  EMERGENCY: AlertOctagon,
  URGENT: AlertTriangle,
  PROMPT_MEDICAL_REVIEW: Info,
  NON_URGENT: Clock,
  ROUTINE: CalendarClock,
} as const;

export { badgeVariants };
