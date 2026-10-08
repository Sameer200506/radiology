/**
 * A blank, valid MedicalCase.
 *
 * Starting from a complete object means the rest of the pipeline never has to
 * defend against partial structures.
 */

import type { MedicalCase } from "@/types/medical";

export function buildEmptyCase(): MedicalCase {
  return {
    demographics: {},
    symptoms: [],
    answers: [],
    medicalHistory: [],
    medications: [],
    allergies: [],
    lifestyle: {},
    documents: [],
    freeText: "",
  };
}

/** Clones a case so an edit never mutates a stored snapshot in place. */
export function cloneCase(caseData: MedicalCase): MedicalCase {
  return structuredClone(caseData);
}

/** One-line summary used for dashboard cards. */
export function summariseCase(caseData: MedicalCase): string {
  const names = caseData.symptoms
    .map((s) => s.name.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (names.length > 0) return names.join(", ").slice(0, 120);

  const firstSentence = caseData.freeText.trim().split(/(?<=[.!?])\s/)[0];
  return (firstSentence ?? "").slice(0, 120) || "No symptoms recorded yet";
}