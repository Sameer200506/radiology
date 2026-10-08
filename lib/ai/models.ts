/**
}
export const MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS ?? 2_048);

/**
 * OpenRouter model registry.
 *
 * Model ids are configuration, not code. Nothing outside this file should
 * hardcode a model string — read it from here so that rotating the free tier
 * is a one-environment-variable change.
 *
 * Environment variables:
 *   OPENROUTER_MODEL            primary model id
 *   OPENROUTER_FALLBACK_MODEL  fallback model id used when the primary fails
 *
 * Both default to `auto`, which lets OpenRouter route to whichever currently
 * available free model is healthy. That is deliberate: free-tier model ids churn
 * frequently, and `auto` survives churn without a deploy. If you want a specific
 * model pinned, set the env var — nothing else changes.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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
  const configured = process.env.OPENROUTER_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}

export function fallbackModel(): string {
  const configured = process.env.OPENROUTER_FALLBACK_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_FALLBACK_MODEL;
}

export function isAiConfigured(): boolean {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return typeof key === "string" && key.length > 0;
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
 * `auto` is routed by OpenRouter and may or may not land on a vision model. We
 * treat it as **not** vision-capable by default so the UI tells the truth. Set
 * OPENROUTER_IMAGE_MODEL to a known vision model to enable image analysis.
 */
export function visionModel(): string | null {
  const configured = process.env.OPENROUTER_IMAGE_MODEL?.trim();
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

export const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 45_000);

/** Baseline budget for any stage without a specific entry below. */
export const MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS ?? 2_048);

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
