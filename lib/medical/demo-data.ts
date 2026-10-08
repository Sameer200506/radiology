/**
 * Demo mode — synthetic data only.
 *
 * Everything in this file is invented for demonstration. There is no real
 * patient, no real identifier, and no real clinical record. The names are
 * fictional, the MRN is obviously fake, and the document text carries a banner
 * saying it is synthetic.
 *
 * Demo scenarios still run through the REAL pipeline: the synthetic report text
 * is passed to the same document-analysis endpoint, the same prompts, and the
 * same Zod validation as an uploaded PDF. Nothing here is a hard-coded AI
 * result.
 */

import type { MedicalCase } from "@/types/medical";
import { buildEmptyCase } from "@/lib/medical/empty-case";

export interface DemoScenario {
  id: string;
  name: string;
  summary: string;
  /** What this scenario demonstrates, shown in the demo picker. */
  teaches: string;
  /** Lower is shown first. */
  order: number;
  build: () => MedicalCase;
}

const SYNTHETIC_BANNER =
  "*** SYNTHETIC DEMO DOCUMENT — NOT A REAL PATIENT RECORD. Invented for demonstration only. ***";

const RESPIRATORY_REPORT_TEXT = `${SYNTHETIC_BANNER}
FAKE RIVERBANK DEMO PATHOLOGY SERVICES
SYNTHETIC FULL BLOOD COUNT (INVENTED VALUES)

Patient: Demo Patient A (fictional)      MRN: DEMO-0000-FAKE
Collected: fictional date                Status: SYNTHETIC

Test                    Result      Unit        Reference Range
Haemoglobin             13.4        g/dL        13.0 - 17.0
White cell count        11.2        x10^9/L     4.0 - 11.0
Neutrophils             78          %           40 - 75
Lymphocytes             15          %           20 - 45
C-reactive protein      24          mg/L        < 5
Platelets               268         x10^9/L     150 - 400
Sodium                  138         mmol/L      135 - 145
Potassium               4.1         mmol/L      3.5 - 5.1
Creatinine              88          umol/L      60 - 110

COMMENTS (written by the fictional laboratory, reproduced verbatim):
SYNTHETIC COMMENTS: Mildly raised white cell count with raised neutrophils.
SYNTHETIC COMMENTS: C-reactive protein above the reference range.
SYNTHETIC ADVICE: Correlate clinically. This synthetic document contains no real data.
END OF SYNTHETIC DOCUMENT`;

const ABNORMAL_FLAGS_REPORT_TEXT = `${SYNTHETIC_BANNER}
FAKE NORTHGATE DEMO IMAGING DEPARTMENT
SYNTHETIC RADIOLOGY REPORT — INVENTED CONTENT

Patient: Demo Patient B (fictional)      Accession: DEMO-FAKE-0001
Study: SYNTHETIC chest radiograph, two views
Comparison: none

TECHNIQUE
SYNTHETIC PA and lateral chest radiograph performed.

FINDINGS
SYNTHETIC: Cardiomediastinal silhouette is within normal limits for a synthetic image.
SYNTHETIC: No pleural effusion is described.
SYNTHETIC: Focal airspace opacity is described in the right lower zone.
SYNTHETIC: No pneumothorax is described.

IMPRESSION
SYNTHETIC IMPRESSION 1: Right lower zone airspace opacity, which may be consistent with
consolidation. Correlate with clinical findings.
SYNTHETIC IMPRESSION 2: Clinical correlation is advised.

RECOMMENDATIONS (as written in the synthetic report)
SYNTHETIC RECOMMENDATION: Correlate with clinical history and consider follow-up imaging
if clinical concern persists.

END OF SYNTHETIC REPORT`;

/* ------------------------------------------------------------------ *
 * Scenario 1 — respiratory symptoms + synthetic blood test
 * ------------------------------------------------------------------ */

function respiratoryScenario(): MedicalCase {
  const base = buildEmptyCase();
  return {
    ...base,
    demographics: { age: 34, sex: "female" },
    symptoms: [
      { name: "Cough", duration: "6 days", severity: "Moderate", source: "user_selected" },
      { name: "Fever", duration: "6 days", severity: "Moderate — 38.4 °C recorded", source: "user_selected" },
      { name: "Sore throat", duration: "4 days", severity: "Mild", source: "user_selected" },
    ],
    answers: [
      { question: "How long have you had these symptoms in total?", answer: "About six days" },
      { question: "Is your cough dry, or are you bringing up mucus or phlegm?", answer: "Coloured (yellow, green or brown) phlegm" },
      { question: "If you have measured a temperature, what was the highest reading?", answer: "38.4" },
      { question: "Are you short of breath while sitting or lying still?", answer: "No" },
      { question: "Do you have any pain, pressure or tightness in your chest?", answer: "No" },
      { question: "Compared with when this started, are your symptoms getting better, staying the same, or getting worse?", answer: "About the same" },
      { question: "In the past two weeks, have you travelled, or been in close contact with someone who was unwell?", answer: "Yes" },
    ],
    medicalHistory: [{ condition: "Mild seasonal allergic rhinitis", status: "past" }],
    medications: ["None that I take regularly"],
    allergies: ["No known allergies"],
    lifestyle: { smoking: "Never smoked", alcohol: "Occasionally", recentTravel: "Yes — within two weeks" },
    documents: [
      {
        id: "demo-doc-respiratory",
        kind: "blood_test",
        fileName: "SYNTHETIC-demo-blood-count.txt",
        mimeType: "text/plain",
        sizeBytes: RESPIRATORY_REPORT_TEXT.length,
        extractedText: RESPIRATORY_REPORT_TEXT,
        uploadStatus: "pending",
      },
    ],
    freeText:
      "I have had a cough for about six days and it is not improving. I felt hot and measured a temperature of 38.4 on the second evening. " +
      "I am bringing up yellow-green phlegm and my throat is sore. I feel tired but I can still walk to work. " +
      "I was near a colleague who was off sick last week. I would like to know whether this is something to worry about.",
  };
}

/* ------------------------------------------------------------------ *
 * Scenario 2 — safety layer demonstration
 * ------------------------------------------------------------------ */

function emergencyScenario(): MedicalCase {
  const base = buildEmptyCase();
  return {
    ...base,
    demographics: { age: 61, sex: "male" },
    symptoms: [
      { name: "Chest pain", duration: "Started 40 minutes ago", severity: "Severe", source: "user_selected" },
      { name: "Shortness of breath", duration: "Started 40 minutes ago", severity: "Severe", source: "user_selected" },
    ],
    answers: [
      { question: "How long have you had these symptoms in total?", answer: "40 minutes" },
      { question: "Are you short of breath while sitting or lying still?", answer: "Yes" },
      { question: "Do you have any pain, pressure or tightness in your chest?", answer: "Yes" },
      { question: "Compared with when this started, are your symptoms getting better, staying the same, or getting worse?", answer: "Getting worse" },
    ],
    medicalHistory: [{ condition: "High blood pressure", status: "active" }],
    medications: ["A fictional antihypertensive, name omitted in demo data"],
    allergies: ["No known allergies"],
    lifestyle: { smoking: "Former smoker" },
    documents: [],
    freeText:
      "I have crushing central chest pain that started about forty minutes ago and it is getting worse. " +
      "I am struggling to breathe even sitting down. My left arm feels heavy. I feel clammy and I am sweating.",
  };
}

/* ------------------------------------------------------------------ *
 * Scenario 3 — laboratory report review with an imaging report
 * ------------------------------------------------------------------ */

function labScenario(): MedicalCase {
  const base = buildEmptyCase();
  return {
    ...base,
    demographics: { age: 47, sex: "prefer_not_to_say" },
    symptoms: [
      { name: "Fatigue", duration: "Around 5 weeks", severity: "Moderate", source: "user_selected" },
      { name: "Breathlessness on exertion", duration: "Around 3 weeks", severity: "Mild to moderate", source: "user_selected" },
    ],
    answers: [
      { question: "How long have you had these symptoms in total?", answer: "Fatigue for about five weeks" },
      { question: "Compared with when this started, are your symptoms getting better, staying the same, or getting worse?", answer: "About the same" },
      { question: "Do you have any pain, pressure or tightness in your chest?", answer: "No" },
      { question: "Are you short of breath while sitting or lying still?", answer: "No" },
    ],
    medicalHistory: [{ condition: "Under investigation by a fictional clinician for anaemia", status: "active" }],
    medications: ["Fictional iron preparation, name omitted in demo data"],
    allergies: ["No known allergies"],
    lifestyle: { smoking: "Never smoked", occupationalExposure: "Fictional office role" },
    documents: [
      {
        id: "demo-doc-lab",
        kind: "blood_test",
        fileName: "SYNTHETIC-demo-blood-count.txt",
        mimeType: "text/plain",
        sizeBytes: RESPIRATORY_REPORT_TEXT.length,
        extractedText: RESPIRATORY_REPORT_TEXT,
        uploadStatus: "pending",
      },
      {
        id: "demo-doc-radiology",
        kind: "radiology_report",
        fileName: "SYNTHETIC-demo-chest-xray-report.txt",
        mimeType: "text/plain",
        sizeBytes: ABNORMAL_FLAGS_REPORT_TEXT.length,
        extractedText: ABNORMAL_FLAGS_REPORT_TEXT,
        uploadStatus: "pending",
      },
    ],
    freeText:
      "I have felt unusually tired for about five weeks and I get out of breath going up stairs, which I could do easily before. " +
      "A fictional clinician has already ordered blood tests and a chest X-ray, and the synthetic results are attached. " +
      "I want to understand what the report says before my fictional follow-up appointment.",
  };
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "respiratory",
    name: "Demo Patient A — Respiratory Symptoms",
    summary: "Six days of cough, fever and coloured phlegm, plus a synthetic blood count.",
    teaches: "The normal happy path: symptoms → questions → synthetic report → structured summary.",
    order: 1,
    build: respiratoryScenario,
  },
  {
    id: "emergency",
    name: "Demo Patient B — Safety Layer",
    summary: "Sudden crushing chest pain with breathlessness.",
    teaches:
      "How the deterministic safety rules override the model and force an emergency banner.",
    order: 2,
    build: emergencyScenario,
  },
  {
    id: "lab-review",
    name: "Demo Patient C — Report Review",
    summary: "Five weeks of fatigue with a synthetic blood count and synthetic chest X-ray report.",
    teaches: "Report-text analysis, value-by-value transcription, and keeping report text distinct from image analysis.",
    order: 3,
    build: labScenario,
  },
];

export function getDemoScenario(id: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function buildDemoCase(id = "respiratory"): MedicalCase {
  return (getDemoScenario(id) ?? DEMO_SCENARIOS[0])!.build();
}

/** Documents in a demo case still need analysis before the assessment runs. */
export function pendingDemoDocuments(caseData: MedicalCase) {
  return caseData.documents.filter((doc) => doc.uploadStatus !== "analyzed" && Boolean(doc.extractedText));
}