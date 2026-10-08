/**
 * Presentation metadata for urgency levels.
 *
 * Deliberately encodes a text label and an icon alongside the colour so that
 * urgency is never communicated by colour alone (WCAG 1.4.1).
 */
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  Clock,
  Info,
  type LucideIcon,
} from "lucide-react";

import { URGENCY_LEVELS, type UrgencyLevel, urgencyRank } from "@/types/medical";

export interface UrgencyPresentation {
  label: string;
  /** Sentence-case level used in prose. */
  prose: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the chip. */
  chipClass: string;
  /** Tailwind classes for the icon/badge container. */
  accentClass: string;
  /** Ring colour for large banners. */
  ringClass: string;
  /** Screen-reader announcement, e.g. "Urgency level 3 of 5". */
  srAnnouncement: string;
}

const PRESENTATION: Record<UrgencyLevel, Omit<UrgencyPresentation, "srAnnouncement">> = {
  ROUTINE: {
    label: "ROUTINE",
    prose: "Routine",
    description:
      "Nothing in the information provided suggests time-sensitive action. A standard appointment is appropriate.",
    icon: CalendarClock,
    chipClass:
      "bg-good/10 text-good border-good/25 dark:bg-good/15 dark:text-good dark:border-good/30",
    accentClass: "bg-good/10 text-good",
    ringClass: "ring-good/25",
  },
  NON_URGENT: {
    label: "NON-URGENT",
    prose: "Non-urgent",
    description:
      "A clinician should review this within the next few days if it persists or worsens.",
    icon: Clock,
    chipClass:
      "bg-info/10 text-info border-info/25 dark:bg-info/15 dark:text-info dark:border-info/30",
    accentClass: "bg-info/10 text-info",
    ringClass: "ring-info/25",
  },
  PROMPT_MEDICAL_REVIEW: {
    label: "PROMPT MEDICAL REVIEW",
    prose: "Prompt medical review",
    description:
      "Contact a healthcare professional within 24 hours for assessment of these symptoms.",
    icon: Info,
    chipClass:
      "bg-caution-soft text-caution border-caution/30 dark:bg-caution/15 dark:text-caution dark:border-caution/35",
    accentClass: "bg-caution/12 text-caution",
    ringClass: "ring-caution/30",
  },
  URGENT: {
    label: "URGENT",
    prose: "Urgent",
    description:
      "Seek medical care today. Do not wait for symptoms to settle on their own.",
    icon: AlertTriangle,
    chipClass:
      "bg-caution/15 text-caution border-caution/40 dark:bg-caution/20 dark:text-caution dark:border-caution/45",
    accentClass: "bg-caution/15 text-caution",
    ringClass: "ring-caution/40",
  },
  EMERGENCY: {
    label: "EMERGENCY",
    prose: "Emergency",
    description:
      "Call your local emergency number now. Do not rely on this application for emergency care.",
    icon: AlertOctagon,
    chipClass:
      "bg-critical/12 text-critical border-critical/35 dark:bg-critical/18 dark:text-critical dark:border-critical/45",
    accentClass: "bg-critical/12 text-critical",
    ringClass: "ring-critical/35",
  },
};

export function urgencyPresentation(level: UrgencyLevel): UrgencyPresentation {
  const base = PRESENTATION[level] ?? PRESENTATION.ROUTINE;
  const position = URGENCY_LEVELS.indexOf(level);
  return {
    ...base,
    srAnnouncement: `Urgency level ${position + 1} of ${URGENCY_LEVELS.length}: ${base.prose}. ${base.description}`,
  };
}

/** Returns whichever of the two levels is more time-critical. */
export function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return urgencyRank(a) >= urgencyRank(b) ? a : b;
}