/**
 * Model registry.
 *
 * Model ids are configuration, not code. Nothing outside this file should
 * hardcode a model string — read it from here so that rotating the free tier
 * is a one-environment-variable change.
 *
 * Two interchangeable providers ship; the active one is selected purely by
 * which key is present in the environment:
 *
 *   - **OpenRouter** (default): `OPENROUTER_API_KEY`. Model ids look like
 *     `google/gemini-2.0-flash-001`; `auto` lets OpenRouter route to whichever
 *     free model is currently healthy, which survives free-tier churn without
 *     a deploy.
 *   - **Google Gemini**: `GEMINI_API_KEY`. Takes precedence when set — that is
 *     what makes the AI work on networks where openrouter.ai is unreachable,
 *     while Vercel deployments can keep using OpenRouter. Model ids are the
 *     plain `generativelanguage.googleapis.com` names, e.g. `gemini-3.8-flash`.
 *
 * `lib/ai/openrouter.ts` remains the single transport entrypoint and dispatches
 * to `lib/ai/gemini.ts` when Gemini is active.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type AiProviderName = "openrouter" | "gemini";

/**
 * The provider is decided purely by configuration: a Gemini key always wins,
 * so a deployment can carry both keys and switch by setting/unsetting one.
 */
export function activeProvider(): AiProviderName {
  return process.env.GEMINI_API_KEY?.trim() ? "gemini" : "openrouter";
}

/** Prompt version, bumped whenever prompt text changes materially. */
export const PROMPT_VERSION = "2026.06.01";

export type ModelCapability = "text" | "vision" | "json";

export interface ModelDescriptor {
  id: string;
  label: string;
  capabilities: ModelCapability[];
  /** Free-tier models are rate-limited; the client backs off more aggressively. */
  freeTier: boolean;
}

export const DEFAULT_MODEL = "auto";
export const DEFAULT_FALLBACK_MODEL = "auto";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-flash-latest";

/**
 * Models we know about. This is metadata only — it drives capability detection
 * so the app can tell the truth about whether vision is available. It is never
 * used to select a model; selection comes from the environment.
 */
export const KNOWN_MODELS: Record<string, ModelDescriptor> = {
  auto: { id: "auto", label: "OpenRouter Auto (free-tier routing)", capabilities: ["text", "json"], freeTier: true },
  "google/gemini-2.0-flash-exp:free": {
    id: "google/gemini-2.0-flash-exp:free",
    label: "Gemini 2.0 Flash (free)",
    capabilities: ["text", "vision", "json"],
    freeTier: true,
  },
  "google/gemini-2.0-flash-001": {
    id: "google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash 001",
    capabilities: ["text", "vision", "json"],
    freeTier: false,
  },
  "gemini-3.8-flash": {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    capabilities: ["text", "vision", "json"],
    freeTier: true,
  },
  "gemini-flash-latest": {
    id: "gemini-flash-latest",
    label: "Gemini Flash Latest",
    capabilities: ["text", "vision", "json"],
    freeTier: true,
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash (retired)",
    capabilities: ["text", "vision", "json"],
    freeTier: true,
  },
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash (retired)",
    capabilities: ["text", "vision", "json"],
    freeTier: true,
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    capabilities: ["text", "vision", "json"],
    freeTier: false,
  },
  "meta-llama/llama-3.3-70b-instruct:free": {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B Instruct (free)",
    capabilities: ["text", "json"],
    freeTier: true,
  },
  "deepseek/deepseek-chat-v3-0324:free": {
    id: "deepseek/deepseek-chat-v3-0324:free",
    label: "DeepSeek Chat v3 (free)",
    capabilities: ["text", "json"],
    freeTier: true,
  },
  "qwen/qwen-2.5-72b-instruct:free": {
    id: "qwen/qwen-2.5-72b-instruct:free",
    label: "Qwen 2.5 72B Instruct (free)",
    capabilities: ["text", "json"],
    freeTier: true,
  },
};

export function primaryModel(): string {
  if (activeProvider() === "gemini") {
    const configured = process.env.GEMINI_MODEL?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_GEMINI_MODEL;
  }
  const configured = process.env.OPENROUTER_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}

export function fallbackModel(): string {
  if (activeProvider() === "gemini") {
    const configured = process.env.GEMINI_FALLBACK_MODEL?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_GEMINI_FALLBACK_MODEL;
  }
  const configured = process.env.OPENROUTER_FALLBACK_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_FALLBACK_MODEL;
}

export function isAiConfigured(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim(),
  );
}

/** Model ids the caller wants tried in order. */
export function modelChain(): string[] {
  const primary = primaryModel();
  const fallback = fallbackModel();
  const chain = [primary];
  if (fallback !== primary) chain.push(fallback);
  return chain;
}

export function describeModel(id: string): ModelDescriptor {
  return (
    KNOWN_MODELS[id] ?? {
      id,
      label: id,
      // Unknown models: assume text+json only. Never assume vision. Claiming a
      // model can see when we cannot verify it is exactly the failure mode the
      // product brief forbids.
      capabilities: ["text", "json"],
      freeTier: id.endsWith(":free") || id === "auto",
    }
  );
}

/**
 * Whether we may send image parts for a given model.
 *
 * OpenRouter's `auto` is routed remotely and may or may not land on a vision
 * model, so it is treated as **not** vision-capable by default so the UI tells
 * the truth. Gemini's flash models see images natively, so the primary model
 * resolves automatically; an explicit image override still wins when set.
 */
export function visionModel(): string | null {
  const configured =
    activeProvider() === "gemini"
      ? process.env.GEMINI_IMAGE_MODEL?.trim()
      : process.env.OPENROUTER_IMAGE_MODEL?.trim();
  if (configured && describeModel(configured).capabilities.includes("vision")) {
    return configured;
  }
  const primary = primaryModel();
  if (primary !== "auto" && describeModel(primary).capabilities.includes("vision")) {
    return primary;
  }
  return null;
}

export function isVisionAnalysisAvailable(): boolean {
  return isAiConfigured() && visionModel() !== null;
}

export const REQUEST_TIMEOUT_MS = Number(
  process.env.GEMINI_TIMEOUT_MS ?? process.env.OPENROUTER_TIMEOUT_MS ?? 45_000,
);

/** Baseline budget for any stage without a specific entry below. */
export const MAX_TOKENS = Number(
  process.env.GEMINI_MAX_TOKENS ?? process.env.OPENROUTER_MAX_TOKENS ?? 2_048,
);

/**
 * Per-stage token budgets.
 *
 * The default is small to keep the free tier cheap, but the final assessment
 * returns 13 fields including two to five explanations and up to ten next steps. Sizing
 * that against the default truncates the JSON mid-write and produces an
 * unparseable response, so stages with a genuinely large schema get their own
 * budget.
 */
export const STAGE_MAX_TOKENS: Record<string, number> = {
  intake: 1_024,
  questions: 1_536,
  document: 2_048,
  imaging: 2_048,
  assessment: 6_144,
  report: 1_024,
};

export function maxTokensForStage(stage: string): number {
  return STAGE_MAX_TOKENS[stage] ?? MAX_TOKENS;
}
