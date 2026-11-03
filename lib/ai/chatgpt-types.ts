/**
 * Types shared by the ChatGPT connection, the OAuth helpers and the transport.
 *
 * This module deliberately has no server-only imports: it is imported by
 * `lib/ai/context.ts` (AsyncLocalStorage) and by tests.
 */

/** OAuth scope that permits the user's ChatGPT plan to pay for inference. */
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";

/** `resource` value required by the OAuth and token endpoints. */
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";

/** Scopes requested for plan usage. Identity scopes are included so the UI can
 * show which ChatGPT account is connected. */
export const CHATGPT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  CHATGPT_PLAN_SCOPE,
] as const;

export interface ChatGptConnection {
  version: 1;
  /** Firebase uid this connection belongs to. The cookie is bound to it. */
  uid: string;
  /** Issued OAuth client id (`oaiapp_...`), not `dynamic_agent_client`. */
  clientId: string;
  /** Stable host identifier sent as `ext_agent_host_id`. */
  agentHostId: string;
  /** OpenAI `sub` claim. */
  subject: string;
  email: string | null;
  name: string | null;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  grantedScopes: string[];
  /** True only when `chatgpt.tokens.use.direct` was granted. */
  planUsage: boolean;
  /** Unix ms. Access tokens last one hour. */
  expiresAt: number;
  /** Unix ms. */
  connectedAt: number;
  /** Model slug chosen for this account, when the catalogue was available. */
  model: string | null;
  /** Pinned separately because a text model is not necessarily a vision model. */
  visionModel: string | null;
}

export interface ChatGptOAuthState {
  uid: string;
  /** Origin the user started from, so the callback can return there. */
  appOrigin: string;
  redirectUri: string;
  clientId: string;
  dynamic: boolean;
  agentHostId: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export interface ChatGptModel {
  id: string;
  label: string;
}

export interface ChatGptConnectionSummary {
  connected: true;
  email: string | null;
  name: string | null;
  planUsage: boolean;
  model: string;
  visionModel: string | null;
  connectedAt: string;
  expiresAt: string;
}
