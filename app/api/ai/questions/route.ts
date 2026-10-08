/**
 * POST /api/ai/questions  — Stage 2: dynamic follow-up questions.
 *
 * Returns 3–8 high-value questions chosen by the model, then validated against
 * the Zod schema. Falls back to a deterministic question set derived from the
 * user's own words if the model is unavailable, so the wizard is never blocked.
 */

import { runQuestions } from "@/lib/ai/stages";
import { isAiError } from "@/lib/ai/openrouter";
import { questionsRequestSchema } from "@/lib/ai/schemas";
import { guardedRoute, jsonError, jsonOk, readJsonBody, API_HEADERS } from "@/lib/api/route-helpers";
import { fallbackQuestions, type QuestionsPayloadOutput } from "@/lib/medical/fallback-questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return guardedRoute({ limit: "questions" }, async ({ request: req }) => {
    const raw = await readJsonBody<unknown>(req, 96 * 1024);

    const parsed = questionsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Some of the information you entered could not be read. Please check the fields and try again.",
        400,
        false,
      );
    }

    const input = parsed.data;
    const symptoms = input.symptoms.filter((s) => s.trim().length > 0);
    const freeText = input.freeText ?? "";

    if (symptoms.length === 0 && freeText.trim().length === 0) {
      return jsonError(
        "VALIDATION_ERROR",
        "Please describe your symptoms, or select at least one symptom, before continuing.",
        400,
        false,
      );
    }

    try {
      const outcome = await runQuestions({
        freeText,
        symptoms,
        ...(input.age === undefined ? {} : { age: input.age }),
        ...(input.sex ? { sex: input.sex } : {}),
        ...(input.intake ? { intake: input.intake } : {}),
      });

      return jsonOk(
        {
          questions: outcome.data,
          source: "model" as const,
          audit: outcome.audit,
        },
        200,
        API_HEADERS,
      );
    } catch (error) {
      // A free-tier model being unavailable must not dead-end the wizard.
      if (isAiError(error)) {
        const fallback: QuestionsPayloadOutput = fallbackQuestions({
          symptoms,
          freeText,
          age: input.age,
          intake: input.intake,
        });

        return jsonOk(
          {
            questions: fallback,
            source: "fallback" as const,
            notice:
              "The AI question generator is temporarily unavailable, so a standard set of intake questions is shown instead. You can skip any of them.",
            error: { code: error.code, retryable: error.retryable },
          },
          200,
          API_HEADERS,
        );
      }
      throw error;
    }
  })(request);
}