/**
 * Urgency reconciliation.
 *
 * Pure, and therefore unit testable. This is the join point between the model's
 * proposed urgency and the deterministic safety layer's floor, and getting it
 * wrong is the most consequential bug available in this codebase.
 *
 * The invariant: **the safety layer is a floor, the model may raise but never
 * lower it.** A model that returns ROUTINE for a case the rules marked EMERGENCY
 * must not be allowed to downgrade it.
 */

import { URGENCY_LEVELS, urgencyRank, type UrgencyLevel } from "@/types/medical";
import type { AssessmentResult, RedFlagFinding } from "@/types/assessment";
import type { AssessmentAiOutputShape } from "@/lib/ai/schemas";

export interface DeterministicDecision {
  level: string;
  redFlags: RedFlagFinding[];
}

export interface ReconciledUrgency {
  urgency: AssessmentResult["urgency"];
  redFlags: RedFlagFinding[];
}

/**
 * Merges the model's urgency proposal with the deterministic floor.
 *
 * Red flags are unioned, never replaced: a deterministic finding always survives,
 * and an AI-identified finding is kept unless the deterministic layer already
 * recorded the same flag.
 */
export function reconcileUrgency(
  aiOutput: Pick<AssessmentAiOutputShape, "urgency" | "redFlags">,
  deterministic: DeterministicDecision,
): ReconciledUrgency {
  const aiLevel = aiOutput.urgency.level;
  const deterministicLevel = coerceLevel(deterministic.level);

  const aiIsLower = urgencyRank(aiLevel) < urgencyRank(deterministicLevel);
  const finalLevel: UrgencyLevel = aiIsLower ? deterministicLevel : aiLevel;

  const deterministicKeys = new Set(
    deterministic.redFlags.map((flag) => flag.flag.trim().toLowerCase()),
  );
  const aiOnly = aiOutput.redFlags.filter(
    (flag) => !deterministicKeys.has(flag.flag.trim().toLowerCase()),
  );

  const reason = aiIsLower
    ? `${deterministicLevel.replace(/_/g, " ")} — this level was set by the application's deterministic safety rules, which take precedence over the AI-generated assessment. ${aiOutput.urgency.reason}`
    : aiOutput.urgency.reason;

  return {
    urgency: {
      level: finalLevel,
      reason,
      overriddenBySafetyRules: aiIsLower,
      aiSuggestedLevel: aiLevel,
    },
    redFlags: [...deterministic.redFlags, ...aiOnly],
  };
}

/**
 * Normalises an untrusted urgency string to a known level.
 *
 * An unrecognised value is treated as NON_URGENT rather than silently becoming
 * EMERGENCY: the deterministic layer only ever *supplies* a level it produced
 * itself, so a corrupt value indicates a bug elsewhere, and failing to the safer
 * middle of the ladder keeps the floor meaningful without inventing an alarm.
 */
export function coerceLevel(value: string): UrgencyLevel {
  const index = URGENCY_LEVELS.indexOf(value as UrgencyLevel);
  return index === -1 ? "NON_URGENT" : (value as UrgencyLevel);
}