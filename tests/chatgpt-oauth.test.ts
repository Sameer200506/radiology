/**
 * Unit tests for the ChatGPT OAuth helpers: state sealing, configuration,
 * authorization URL shape, model catalogue handling and scope checks.
 *
 * No network: the model listing test stubs fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DYNAMIC_AGENT_CLIENT_ID,
  agentHostIdFor,
  buildAuthorizationUrl,
  decodeOAuthState,
  encodeOAuthState,
  grantedScopes,
  hasPlanUsageScope,
  listChatGptModels,
  pickChatGptModel,
  resolveChatGptOAuthConfig,
} from "@/lib/ai/chatgpt-oauth";
import {
  CHATGPT_PLAN_SCOPE,
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  type ChatGptOAuthState,
} from "@/lib/ai/chatgpt-types";

const ORIGINAL_ENV = { ...process.env };

const CONFIG_KEYS = [
  "AI_CONNECTION_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "OPENAI_SIWC_CLIENT_ID",
  "OPENAI_SIWC_REDIRECT_URI",
  "OPENAI_AGENT_HOST_ID",
] as const;

function resetEnv() {
  for (const key of CONFIG_KEYS) delete process.env[key];
}

function state(overrides: Partial<ChatGptOAuthState> = {}): ChatGptOAuthState {
  return {
    uid: "firebase-user-1",
    appOrigin: "http://localhost:3000",
    redirectUri: "http://127.0.0.1:3000/api/ai/connection/chatgpt/callback",
    clientId: "oaiapp_test",
    dynamic: true,
    agentHostId: agentHostIdFor("http://localhost:3000"),
    nonce: "nonce-value",
    codeVerifier: "verifier-value",
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("OAuth state", () => {
  it("round-trips the transaction without exposing it in plain text", () => {
    const input = state();

    const encoded = encodeOAuthState(input);

    expect(encoded.startsWith("v1.")).toBe(true);
    expect(encoded).not.toContain("verifier-value");
    expect(decodeOAuthState(encoded)).toEqual(input);
  });

  it("rejects state older than the ten-minute window", () => {
    const encoded = encodeOAuthState(state({ createdAt: Date.now() - 11 * 60_000 }));

    expect(decodeOAuthState(encoded)).toBeNull();
  });

  it("rejects a tampered state value", () => {
    const encoded = encodeOAuthState(state());
    const parts = encoded.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("{}").toString("base64url")}`;

    expect(decodeOAuthState(tampered)).toBeNull();
  });

  it("rejects state with the wrong shape", () => {
    const encoded = encodeOAuthState({ ...state(), uid: 42 } as unknown as ChatGptOAuthState);

    expect(decodeOAuthState(encoded)).toBeNull();
  });
});

describe("deployment configuration", () => {
  it("uses the 127.0.0.1 loopback callback for a local app on localhost", () => {
    const config = resolveChatGptOAuthConfig(
      new Request("http://localhost:3000/api/ai/connection/chatgpt/start"),
    );

    expect(config.available).toBe(true);
    expect(config.dynamic).toBe(true);
    expect(config.clientId).toBe(DYNAMIC_AGENT_CLIENT_ID);
    expect(config.appOrigin).toBe("http://localhost:3000");
    expect(config.redirectUri).toBe(
      "http://127.0.0.1:3000/api/ai/connection/chatgpt/callback",
    );
  });

  it("keeps the loopback port when the app runs on a custom port", () => {
    const config = resolveChatGptOAuthConfig(
      new Request("http://127.0.0.1:4310/api/ai/connection/chatgpt/start"),
    );

    expect(config.redirectUri).toBe(
      "http://127.0.0.1:4310/api/ai/connection/chatgpt/callback",
    );
  });

  it("refuses the dynamic flow on a hosted HTTPS deployment", () => {
    const config = resolveChatGptOAuthConfig(
      new Request("https://medassist.example.com/api/ai/connection/chatgpt/start"),
    );

    expect(config.available).toBe(false);
    expect(config.reason).toMatch(/OPENAI_SIWC_CLIENT_ID/);
  });

  it("uses a registered client id and callback on a hosted deployment", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://medassist.example.com";
    process.env.OPENAI_SIWC_CLIENT_ID = "oaiapp_registered";
    process.env.OPENAI_SIWC_REDIRECT_URI =
      "https://medassist.example.com/api/ai/connection/chatgpt/callback";

    const config = resolveChatGptOAuthConfig(
      new Request("https://medassist.example.com/api/ai/connection/chatgpt/start"),
    );

    expect(config.available).toBe(true);
    expect(config.dynamic).toBe(false);
    expect(config.clientId).toBe("oaiapp_registered");
    expect(config.redirectUri).toBe(
      "https://medassist.example.com/api/ai/connection/chatgpt/callback",
    );
  });

  it("derives a stable, opaque host id from the deployment origin", () => {
    const first = agentHostIdFor("http://localhost:3000");
    const second = agentHostIdFor("http://localhost:3000");
    const other = agentHostIdFor("https://medassist.example.com");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("prefers an explicitly configured host id", () => {
    process.env.OPENAI_AGENT_HOST_ID = "urn:uuid:configured";

    expect(agentHostIdFor("http://localhost:3000")).toBe("urn:uuid:configured");
  });
});

describe("authorization URL", () => {
  it("includes the PKCE, resource, scope and dynamic-registration parameters", () => {
    const url = buildAuthorizationUrl({
      clientId: DYNAMIC_AGENT_CLIENT_ID,
      redirectUri: "http://127.0.0.1:3000/api/ai/connection/chatgpt/callback",
      state: "sealed-state",
      nonce: "nonce",
      codeChallenge: "challenge",
      dynamic: true,
      agentHostId: "urn:uuid:host",
      agentName: "MedAssist AI",
      loginHint: "doctor@example.com",
    });

    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/api/accounts/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe(DYNAMIC_AGENT_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(CHATGPT_SCOPES.join(" "));
    expect(url.searchParams.get("resource")).toBe(CHATGPT_RESOURCE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:host");
    expect(url.searchParams.get("agent_name_hint")).toBe("MedAssist AI");
    expect(url.searchParams.get("login_hint")).toBe("doctor@example.com");
  });

  it("omits the registration hint for a registered client", () => {
    const url = buildAuthorizationUrl({
      clientId: "oaiapp_registered",
      redirectUri: "https://medassist.example.com/callback",
      state: "s",
      nonce: "n",
      codeChallenge: "c",
      dynamic: false,
      agentHostId: "urn:uuid:host",
      agentName: "MedAssist AI",
    });

    expect(url.searchParams.has("agent_name_hint")).toBe(false);
  });
});

describe("scope helpers", () => {
  it("splits a space-delimited scope string", () => {
    expect(grantedScopes("openid  profile\temail")).toEqual(["openid", "profile", "email"]);
    expect(grantedScopes(null)).toEqual([]);
  });

  it("detects the plan-usage scope only when it was actually granted", () => {
    expect(hasPlanUsageScope(["openid", CHATGPT_PLAN_SCOPE])).toBe(true);
    expect(hasPlanUsageScope(["openid", "profile", "email"])).toBe(false);
  });
});

describe("model catalogue", () => {
  it("lists visible models and ignores hidden entries", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" },
            { slug: "text-embedding-3-large", visibility: "list" },
            { slug: "gpt-5-mini", display_name: "GPT-5 mini", visibility: "hidden" },
            { id: "gpt-5.2" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const models = await listChatGptModels("access-token");

    expect(models).toEqual([
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "text-embedding-3-large", label: "text-embedding-3-large" },
      { id: "gpt-5.2", label: "gpt-5.2" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-token");
  });

  it("accepts the data-shaped catalogue as well", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), { status: 200 }),
      ),
    );

    await expect(listChatGptModels("token")).resolves.toEqual([
      { id: "gpt-test", label: "gpt-test" },
    ]);
  });

  it("prefers a strong general model and never selects embeddings or audio models", () => {
    const picked = pickChatGptModel([
      { id: "text-embedding-3-large", label: "Embedding" },
      { id: "whisper-1", label: "Whisper" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-5.2", label: "GPT-5.2" },
    ]);

    expect(picked?.id).toBe("gpt-6.1-sol");
  });

  it("returns null when the catalogue has no chat model", () => {
    expect(
      pickChatGptModel([
        { id: "text-embedding-3-small", label: "Embedding" },
        { id: "dall-e-3", label: "Image" },
      ]),
    ).toBeNull();
  });
});
