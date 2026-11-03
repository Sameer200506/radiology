import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { ChatGptConnection } from "@/lib/ai/chatgpt-types";

/**
 * Per-request AI context.
 *
 * `guardedRoute` reads the user's ChatGPT connection from its encrypted cookie
 * once per request and stores it here. The AI pipeline then reads it through
 * `models.ts` without every stage having to accept a provider argument.
 *
 * The store is mutable because a request may refresh an expired token halfway
 * through a multi-stage assessment; later stages must see the replacement.
 */
export interface AiRequestContext {
  chatgpt: ChatGptConnection | null;
  /** Whether the request arrived over HTTPS, for writing refreshed cookies. */
  secure: boolean;
}

const storage = new AsyncLocalStorage<AiRequestContext>();

export function runWithAiContext<T>(
  context: AiRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getAiRequestContext(): AiRequestContext | null {
  return storage.getStore() ?? null;
}

export function getAiConnection(): ChatGptConnection | null {
  return storage.getStore()?.chatgpt ?? null;
}

/** Replaces the active connection after a token refresh. */
export function setAiConnection(connection: ChatGptConnection | null): void {
  const store = storage.getStore();
  if (store) store.chatgpt = connection;
}
