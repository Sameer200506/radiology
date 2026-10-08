"use client";

import * as React from "react";
import Link from "next/link";
import { AlertOctagon, PhoneCall, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { urgencyPresentation } from "@/lib/medical/urgency";
import type { TriageResult } from "@/types/assessment";
import type { UrgencyLevel } from "@/types/medical";

/**
 * Emergency banner.
 *
 * Rendered ABOVE the rest of the workflow — on step 1, as soon as the
 * deterministic rules fire — before anything else on the page. It is never
 * dismissible, because the whole point is that the user cannot scroll past it.
 *
 * Role="alert" + aria-live="assertive" so screen readers announce it the moment
 * it appears.
 */
export function EmergencyBanner({
  triage,
  className,
}: {
  triage: Pick<TriageResult, "level" | "emergencyNotice">;
  className?: string;
}) {
  const presentation = urgencyPresentation(triage.level);
  const isEmergency = triage.level === "EMERGENCY";
  const isUrgent = triage.level === "URGENT";

  const heading = isEmergency
    ? "This may be a medical emergency"
    : isUrgent
      ? "These symptoms need same-day medical review"
      : "Please arrange a prompt medical review";

  const body =
    triage.emergencyNotice ??
    `Based on what you have described, the urgency level is ${presentation.label}. ${presentation.description}`;

  const tone = isEmergency
    ? "border-critical/45 bg-critical/10"
    : isUrgent
      ? "border-caution/45 bg-caution/10"
      : "border-caution/30 bg-caution-soft/40";

  const Icon = isEmergency ? AlertOctagon : ShieldAlert;
  const iconTone = isEmergency ? "bg-critical/15 text-critical" : "bg-caution/15 text-caution";

  return (
    <motion.section
      role="alert"
      aria-live="assertive"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn("relative overflow-hidden rounded-3xl border p-5 sm:p-6", tone, className)}
    >
      <div className="flex items-start gap-4">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", iconTone)}>
          <Icon className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight text-ink">{heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/90">{body}</p>

          <ul className="mt-4 space-y-1.5 text-sm text-ink/85">
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>Do not wait for this assessment to finish, and do not delay seeking care for it.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>
                If you feel worse while reading this, contact a healthcare professional immediately.
              </span>
            </li>
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isEmergency ? (
              <a
                href="tel:112"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-critical px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <PhoneCall className="size-4" aria-hidden="true" />
                Call emergency services
              </a>
            ) : null}
            <Link
              href="https://www.who.int/health-topics/emergency-care"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-ink underline underline-offset-4 hover:opacity-80"
            >
              What counts as an emergency?
            </Link>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/**
 * Non-blocking urgency notice, used once the workflow is underway.
 * Same information, lower visual weight, still text-first.
 */
export function UrgencyNotice({
  level,
  reason,
  escalatedByRules,
  className,
}: {
  level: UrgencyLevel;
  reason: string;
  escalatedByRules?: boolean;
  className?: string;
}) {
  const presentation = urgencyPresentation(level);
  const Icon = presentation.icon;

  return (
    <aside
      aria-labelledby="urgency-notice-heading"
      className={cn(
        "glass flex items-start gap-3 rounded-2xl border p-4",
        level === "EMERGENCY" && "border-critical/40 bg-critical/8",
        level === "URGENT" && "border-caution/40 bg-caution/8",
        className,
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", presentation.accentClass)}>
        <Icon className="size-[1.15rem]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2
          id="urgency-notice-heading"
          className="text-sm font-semibold tracking-tight text-ink"
        >
          {presentation.label}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{reason || presentation.description}</p>
        {escalatedByRules ? (
          <p className="mt-2 rounded-lg border border-caution/30 bg-caution-soft/50 px-2.5 py-1.5 text-xs leading-relaxed text-caution">
            This level was set by the application&apos;s deterministic safety rules, which take
            priority over the AI-generated assessment.
          </p>
        ) : null}
      </div>
    </aside>
  );
}