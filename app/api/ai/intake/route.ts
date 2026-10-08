/**
 * POST /api/ai/intake  — Stage 1: Intake Analyzer.
 *
 * Runs the deterministic red-flag scan FIRST (free, no model call) so that a
 * life-threatening description is surfaced to the user before any AI work and
 * regardless of whether the AI is configured. The intake model call then
 * organises what the user said.
 */

import { NextResponse } from "next/server";

import { runIntake } from "@/lib/ai/stages";
import { intakeRequestSchema } from "@/lib/ai/schemas";
import { evaluateRedFlags, scanForUrgentRedFlags } from "@/lib/medical/triage";
import { guardedRoute, jsonError, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return guardedRoute({ limit: "intake" }, async ({ request: req }) => {
    const raw = await readJsonBody<unknown>(req, 64 * 1024);

    const parsed = intakeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Some of the information you entered could not be read. Please check the fields and try again.",
        400,
        false,
      );
    }

    const input = parsed.data;
    const symptoms = input.selectedSymptoms.filter((s) => s.trim().length > 0);
    const freeText = input.freeText ?? "";

    if (symptoms.length === 0 && freeText.trim().length === 0) {
      return jsonError(
        "VALIDATION_ERROR",
        "Please describe your symptoms, or select at least one symptom, before continuing.",
        400,
        false,
      );
    }

    // ---- Deterministic safety layer, before any model call -------------------
    const triage = evaluateRedFlags({
      demographics: {
        ...(input.age === undefined ? {} : { age: input.age }),
        ...(input.sex ? { sex: input.sex } : {}),
      },
      symptoms: symptoms.map((name) => ({ name, source: "user_selected" })),
      answers: [],
      medicalHistory: [],
      medications: input.medications,
      allergies: input.allergies,
      documents: [],
      freeText,
      lifestyle: {},
    });

    const outcome = await runIntake({
      freeText,
      selectedSymptoms: symptoms,
      ...(input.age === undefined ? {} : { age: input.age }),
      ...(input.sex ? { sex: input.sex } : {}),
      ...(input.duration ? { duration: input.duration } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
      medicalHistory: input.medicalHistory,
      medications: input.medications,
      allergies: input.allergies,
    });

    return jsonOk(
      {
        intake: outcome.data,
        triage: {
          level: triage.level,
          escalated: triage.escalated,
          redFlags: triage.redFlags,
          emergencyNotice: triage.emergencyNotice,
          firedRules: triage.firedRules,
        },
        audit: outcome.audit,
      },
      200,
      API_HEADERS,
    );
  })(
    request,
  );
}

/**
 * POST /api/ai/safety-check
 *
 * Zero-cost endpoint used by the wizard to re-run the deterministic rules
 * whenever the user answers a question. No model call at all.
 */
export async function PUT(request: Request) {
  return guardedRoute({ limit: "session" }, async ({ request: req }) => {
    const raw = await readJsonBody<{
      symptoms?: string[];
      answers?: Array<{ question: string; answer: string }>;
      freeText?: string;
      age?: number;
    }>(req, 128 * 1024);

    const result = scanForUrgentRedFlags({
      symptoms: Array.isArray(raw.symptoms) ? raw.symptoms : [],
      answers: Array.isArray(raw.answers) ? raw.answers : [],
      freeText: typeof raw.freeText === "string" ? raw.freeText : "",
      ...(typeof raw.age === "number" ? { age: raw.age } : {}),
    });

    return NextResponse.json(
      {
        triage: {
          level: result.level,
          escalated: result.escalated,
          redFlags: result.redFlags,
          emergencyNotice: result.emergencyNotice,
          firedRules: result.firedRules,
        },
      },
      { status: 200, headers: API_HEADERS },
    );
  })(request);
}