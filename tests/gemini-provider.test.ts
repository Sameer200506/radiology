/**
 * Unit tests for the Gemini transport and provider selection.
 *
 * All network access is stubbed; no key is required. These tests verify that
 * the Gemini transport speaks the same contract as the OpenRouter transport:
 * result shaping, safe error codes, timeout mapping, and that `complete()`
 * actually dispatches to Gemini when GEMINI_API_KEY is present.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callGemini } from "@/lib/ai/gemini";
import { activeProvider, isAiConfigured, modelChain, primaryModel, visionModel } from "@/lib/ai/models";
import { AiError, complete, isAiError } from "@/lib/ai/openrouter";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(patch: Record<string, string | undefined> = {}) {
  for (const key of [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_FALLBACK_MODEL",
    "GEMINI_IMAGE_MODEL",
    "GEMINI_TIMEOUT_MS",
    "GEMINI_MAX_TOKENS",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_IMAGE_MODEL",
  ]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(patch)) process.env[key] = value;
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function geminiBody(text: string, finishReason = "STOP"): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  resetEnv({ GEMINI_API_KEY: "test-key", OPENROUTER_API_KEY: "" });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function errorFrom(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    if (isAiError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to throw an AiError");
}

describe("provider selection", () => {
  it("prefers Gemini when GEMINI_API_KEY is present, even alongside OpenRouter", () => {
    resetEnv({ GEMINI_API_KEY: "gem", OPENROUTER_API_KEY: "or" });
    expect(activeProvider()).toBe("gemini");
  });

  it("falls back to OpenRouter when only its key is set", () => {
    resetEnv({ OPENROUTER_API_KEY: "or" });
    expect(activeProvider()).toBe("openrouter");
  });

  it("reports the app as unconfigured when neither key is set", () => {
    resetEnv();
    expect(isAiConfigured()).toBe(false);
    expect(activeProvider()).toBe("openrouter");
  });

  it("builds gemini chain from the gemini env vars", () => {
    resetEnv({ GEMINI_API_KEY: "k" });
    expect(primaryModel()).toBe("gemini-2.5-flash");
    expect(modelChain()).toEqual(["gemini-2.5-flash", "gemini-2.0-flash"]);
  });

  it("treats a configured OpenRouter auto model as not vision-capable", () => {
    resetEnv({ OPENROUTER_API_KEY: "k" });
    expect(visionModel()).toBeNull();
  });

  it("treats the gemini primary as vision-capable automatically", () => {
    resetEnv({ GEMINI_API_KEY: "k" });
    expect(visionModel()).toBe("gemini-2.5-flash");
  });
});

describe("callGemini", () => {
  const options = { system: "be helpful", user: "hello", maxTokens: 64 } as const;

  it("shapes the request and returns the flattened text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(geminiBody('{"ok":true}'), { status: 200 }),
    );

    const result = await callGemini("gemini-2.5-flash", options, 5_000);

    expect(result.text).toBe('{"ok":true}');
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.usedFallback).toBe(false);
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 22 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    const body = JSON.parse(String(init.body)) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      generationConfig: { responseMimeType: string; maxOutputTokens: number };
    };
    expect(body.contents[0]?.parts[0]?.text).toBe("hello");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBe(64);
  });

  it("maps 429 to a retryable rate-limit error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 429, message: "Resource exhausted" } }), { status: 429 }),
    );
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_RATE_LIMITED");
    expect(error.retryable).toBe(true);
  });

  it("maps 403 to a non-retryable configuration error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(error.retryable).toBe(false);
  });

  it("maps 404 to a retryable model-unavailable error so the chain continues", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 404, message: "model not found" } }), { status: 404 }),
    );
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_MODEL_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("throws AI_NOT_CONFIGURED without spending a request when the key is missing", async () => {
    resetEnv();
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty candidates blocked by safety filters", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
        { status: 200 },
      ),
    );
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_INVALID_RESPONSE");
    expect(error.message).toMatch(/declined/i);
  });

  it("rejects a MAX_TOKENS truncation with a token cut-off error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(geminiBody('{"half":', "MAX_TOKENS"), { status: 200 }));
    const error = await errorFrom(callGemini("gemini-2.5-flash", options, 5_000));
    expect(error.code).toBe("AI_INVALID_RESPONSE");
    expect(error.message).toMatch(/cut off/i);
  });

  it("respects an external abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((_, reject) => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        reject(e);
      }),
    );
    const error = await errorFrom(
      callGemini("gemini-2.5-flash", { ...options, signal: controller.signal }, 5_000),
    );
    expect(error.code).toBe("AI_TIMEOUT");
  });
});

describe("complete() dispatch", () => {
  it("routes through the Gemini transport when Gemini is configured", async () => {
    fetchMock.mockResolvedValueOnce(new Response(geminiBody('{"value":7}'), { status: 200 }));

    const result = await complete({ system: "s", user: "u", maxTokens: 32 });

    expect(result.text).toBe('{"value":7}');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-2.5-flash");
  });
});
