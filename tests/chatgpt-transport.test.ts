/**
 * Unit tests for the ChatGPT Responses API transport.
 *
 * The network is stubbed with a ReadableStream that emits SSE blocks, so these
 * tests verify the real protocol handling: delta accumulation, the requirement
 * for `response.completed`, plan-usage failures and HTTP error mapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The transport lazy-imports the connection store, which imports next/headers.
// Tokens are valid in these tests, so no cookie access happens; the mock only
// keeps the Next.js request module out of the Node test environment.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { callChatGpt, parseSseData } from "@/lib/ai/chatgpt";
import { getChatGptAccessToken } from "@/lib/ai/chatgpt-connection";
import { getAiConnection, runWithAiContext } from "@/lib/ai/context";
import type { ChatGptConnection } from "@/lib/ai/chatgpt-types";
import { CHATGPT_PLAN_SCOPE } from "@/lib/ai/chatgpt-types";
import {
  activeProvider,
  isAiConfigured,
  primaryModel,
  visionModel,
} from "@/lib/ai/models";
import { AiError } from "@/lib/ai/provider-core";

const ORIGINAL_ENV = { ...process.env };
const fetchMock = vi.fn();

function connection(overrides: Partial<ChatGptConnection> = {}): ChatGptConnection {
  return {
    version: 1,
    uid: "firebase-user-1",
    clientId: "oaiapp_test",
    agentHostId: "urn:uuid:host",
    subject: "openai-subject",
    email: "doctor@example.com",
    name: "Dr Example",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    grantedScopes: ["openid", "profile", "email", CHATGPT_PLAN_SCOPE],
    planUsage: true,
    expiresAt: Date.now() + 60 * 60_000,
    connectedAt: Date.now() - 60_000,
    model: "gpt-test",
    visionModel: null,
    ...overrides,
  };
}

function withConnection<T>(
  value: ChatGptConnection,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithAiContext({ chatgpt: value, secure: false }, fn);
}

function event(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function errorFrom(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiError) return error;
    throw error;
  }
  throw new Error("expected the call to throw an AiError");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.CHATGPT_MODEL;
  delete process.env.CHATGPT_FALLBACK_MODEL;
  delete process.env.CHATGPT_VISION_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("parseSseData", () => {
  it("extracts a JSON event from an SSE block", () => {
    expect(
      parseSseData('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi"}'),
    ).toEqual({ type: "response.output_text.delta", delta: "Hi" });
  });

  it("joins multiple data lines", () => {
    expect(parseSseData('data: {"type":\ndata: "x"}')).toEqual({ type: "x" });
  });

  it("ignores the terminator, empty blocks and invalid JSON", () => {
    expect(parseSseData("data: [DONE]")).toBeNull();
    expect(parseSseData("")).toBeNull();
    expect(parseSseData("event: ping")).toBeNull();
    expect(parseSseData("data: {not json}")).toBeNull();
  });
});

describe("provider selection", () => {
  it("uses the connected user's ChatGPT plan ahead of deployment keys", async () => {
    process.env.GEMINI_API_KEY = "deployment-key";

    const selected = await withConnection(connection(), async () => ({
      provider: activeProvider(),
      primary: primaryModel(),
      configured: isAiConfigured(),
      vision: visionModel(),
    }));

    expect(selected).toEqual({
      provider: "chatgpt",
      primary: "gpt-test",
      configured: true,
      vision: null,
    });
  });

  it("lets CHATGPT_MODEL override the model recorded at connection time", async () => {
    process.env.CHATGPT_MODEL = "gpt-6.1-sol";

    const primary = await withConnection(connection({ model: "gpt-5.2" }), async () =>
      primaryModel(),
    );

    expect(primary).toBe("gpt-6.1-sol");
  });

  it("only reports vision when it was explicitly pinned", async () => {
    process.env.CHATGPT_VISION_MODEL = "gpt-6.1-vision";

    const vision = await withConnection(connection(), async () => visionModel());

    expect(vision).toBe("gpt-6.1-vision");
  });

  it("treats a connection without plan usage as non-ChatGPT and keeps the deployment provider", async () => {
    process.env.GEMINI_API_KEY = "deployment-key";

    const provider = await withConnection(
      connection({ planUsage: false }),
      async () => activeProvider(),
    );

    expect(provider).toBe("gemini");
  });

  it("counts a ChatGPT connection as configured without a deployment key", async () => {
    const configured = await withConnection(connection(), async () => isAiConfigured());

    expect(configured).toBe(true);
  });
});

describe("token refresh", () => {
  function expired(overrides: Partial<ChatGptConnection> = {}): ChatGptConnection {
    return connection({ expiresAt: Date.now() - 1_000, ...overrides });
  }

  function refreshResponse(scope: string): Response {
    return new Response(
      JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        token_type: "Bearer",
        expires_in: 3_600,
        scope,
      }),
      { status: 200 },
    );
  }

  it("replaces rotated tokens and preserves plan usage from the granted scopes", async () => {
    fetchMock.mockResolvedValueOnce(
      refreshResponse(`openid profile email ${CHATGPT_PLAN_SCOPE}`),
    );
    const before = expired();

    const updated = await withConnection(before, () => getChatGptAccessToken(before));

    expect(updated.accessToken).toBe("new-access-token");
    expect(updated.refreshToken).toBe("new-refresh-token");
    expect(updated.planUsage).toBe(true);
    expect(updated.expiresAt).toBeGreaterThan(Date.now());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("oaiapp_test");
    expect(body.get("refresh_token")).toBe("refresh-token");
    expect(body.get("resource")).toBe("https://api.openai.com/v1");
  });

  it("marks plan usage disabled when the refreshed grant no longer includes it", async () => {
    fetchMock.mockResolvedValueOnce(refreshResponse("openid profile email"));
    const before = expired();

    const updated = await withConnection(before, () => getChatGptAccessToken(before));

    expect(updated.planUsage).toBe(false);
    expect(updated.grantedScopes).toEqual(["openid", "profile", "email"]);
  });

  it("clears the connection on a terminal refresh token error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "refresh_token_reused",
          error_description: "That refresh token was already used.",
        }),
        { status: 400 },
      ),
    );
    const before = expired();
    let after: ChatGptConnection | null = before;

    const error = await errorFrom(
      withConnection(before, async () => {
        try {
          await getChatGptAccessToken(before);
        } finally {
          after = getAiConnection();
        }
      }),
    );

    expect(error.code).toBe("AI_CONNECTION_REQUIRED");
    expect(error.retryable).toBe(false);
    expect(after).toBeNull();
  });

  it("keeps the connection when the deployment's client id is misconfigured", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "Unknown client.",
        }),
        { status: 401 },
      ),
    );
    const before = expired();
    let after: ChatGptConnection | null = null;

    const error = await errorFrom(
      withConnection(before, async () => {
        try {
          await getChatGptAccessToken(before);
        } finally {
          after = getAiConnection();
        }
      }),
    );

    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(error.retryable).toBe(false);
    expect(after).not.toBeNull();
  });
});

describe("callChatGpt", () => {
  const options = { system: "system prompt", user: "user prompt", maxTokens: 128 };

  it("sends a streaming, non-stored Responses request and collects the deltas", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({ type: "response.output_text.delta", delta: '{"answer":' }),
        event({ type: "response.output_text.delta", delta: '"ok"}' }),
        event({
          type: "response.completed",
          response: {
            id: "resp_1",
            model: "gpt-test",
            status: "completed",
            usage: { input_tokens: 12, output_tokens: 5 },
          },
        }),
      ]),
    );

    const result = await withConnection(connection(), () =>
      callChatGpt("gpt-test", options, 5_000),
    );

    expect(result.text).toBe('{"answer":"ok"}');
    expect(result.provider).toBe("ChatGPT");
    expect(result.model).toBe("gpt-test");
    expect(result.usedFallback).toBe(false);
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-token",
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.instructions).toBe("system prompt");
    expect(body.max_output_tokens).toBe(128);
    expect(body.text).toEqual({ format: { type: "json_object" } });
  });

  it("sends image parts as input_image data URLs", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.completed",
          response: { status: "completed", output: [] },
        }),
        event({ type: "response.output_text.delta", delta: "seen" }),
      ]),
    );

    await withConnection(connection(), () =>
      callChatGpt(
        "gpt-test",
        { ...options, images: [{ base64: "YWJj", mimeType: "image/png" }] },
        5_000,
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      input: Array<{ content: Array<Record<string, string>> }>;
    };
    expect(body.input[0]?.content).toEqual([
      { type: "input_text", text: "user prompt" },
      { type: "input_image", image_url: "data:image/png;base64,YWJj" },
    ]);
  });

  it("uses the completed response text when no delta arrived", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: '{"final":true}' }],
              },
            ],
          },
        }),
      ]),
    );

    const result = await withConnection(connection(), () =>
      callChatGpt("gpt-test", options, 5_000),
    );

    expect(result.text).toBe('{"final":true}');
  });

  it("rejects a stream that ends without response.completed", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({ type: "response.output_text.delta", delta: "partial" }),
      ]),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_INVALID_RESPONSE");
    expect(error.retryable).toBe(true);
  });

  it("maps a plan usage-limit failure to AI_QUOTA_EXHAUSTED", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "subscription_sharing_usage_limit_exceeded",
              message: "The usage limit for this account has been reached.",
            },
          },
        }),
      ]),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_QUOTA_EXHAUSTED");
    expect(error.retryable).toBe(false);
  });

  it("treats temporarily unavailable plan usage as retryable", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "subscription_sharing_usage_unavailable",
              message: "Plan usage could not be checked.",
            },
          },
        }),
      ]),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.retryable).toBe(true);
  });

  it("does not ask for OAuth again when the account is not eligible", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "subscription_sharing_user_not_eligible",
              message: "Plan usage is not available for this workspace.",
            },
          },
        }),
      ]),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.retryable).toBe(false);
  });

  it("does not retry an unsupported request capability", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        event({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "subscription_sharing_unsupported_capability",
              message: "This model does not support that input.",
            },
          },
        }),
      ]),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_MODEL_UNAVAILABLE");
    expect(error.retryable).toBe(false);
  });

  it("maps an HTTP 401 to AI_CONNECTION_REQUIRED", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), {
        status: 401,
      }),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_CONNECTION_REQUIRED");
  });

  it("maps an HTTP 429 usage limit to AI_QUOTA_EXHAUSTED", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Plan usage limit reached" } }),
        { status: 429 },
      ),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_QUOTA_EXHAUSTED");
  });

  it("treats an HTTP 403 eligibility failure as terminal, not a reconnect", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "subscription_sharing_user_not_eligible",
            message: "Plan usage is not available for this workspace.",
          },
        }),
        { status: 403 },
      ),
    );

    const error = await errorFrom(
      withConnection(connection(), () => callChatGpt("gpt-test", options, 5_000)),
    );

    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.retryable).toBe(false);
  });

  it("retries once without the JSON format hint when a model rejects it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Invalid value for 'text.format'" } }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        streamResponse([
          event({ type: "response.output_text.delta", delta: "{}" }),
          event({
            type: "response.completed",
            response: { status: "completed" },
          }),
        ]),
      );

    const result = await withConnection(connection(), () =>
      callChatGpt("gpt-test", options, 5_000),
    );

    expect(result.text).toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondInit.body)) as Record<string, unknown>;
    expect(secondBody.text).toBeUndefined();
  });

  it("refuses to spend a request when plan usage was not granted", async () => {
    const error = await errorFrom(
      withConnection(connection({ planUsage: false }), () =>
        callChatGpt("gpt-test", options, 5_000),
      ),
    );

    expect(error.code).toBe("AI_CONNECTION_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run outside a request that has no connection", async () => {
    const error = await errorFrom(callChatGpt("gpt-test", options, 5_000));

    expect(error.code).toBe("AI_CONNECTION_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
