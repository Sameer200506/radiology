import "server-only";

import { randomBytes } from "node:crypto";

import type { ChatGptConnection } from "@/lib/ai/chatgpt-types";

/**
 * Short-lived hand-off between the loopback OAuth callback and the app origin.
 *
 * The open-source ChatGPT flow requires the callback host to be `127.0.0.1`,
 * while a developer often opens the app at `localhost`. Cookies are not shared
 * between those hosts, so the callback cannot write the connection cookie
 * directly. Instead it leaves the sealed record in this small in-memory map and
 * redirects to the app origin with an opaque, single-use id.
 *
 * Only a random id appears in the URL; tokens never do. The entry is bound to
 * the Firebase uid, expires after five minutes, and is consumed once. This path
 * is only used for a local deployment; a hosted client uses its registered HTTPS
 * callback and writes the cookie directly.
 */
interface HandoffEntry {
  connection: ChatGptConnection;
  expiresAt: number;
}

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const entries = new Map<string, HandoffEntry>();

function sweep(now: number): void {
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== "string") break;
    entries.delete(oldest);
  }
}

export function putConnectionHandoff(connection: ChatGptConnection): string {
  const now = Date.now();
  sweep(now);

  const id = randomBytes(24).toString("base64url");
  entries.set(id, { connection, expiresAt: now + TTL_MS });
  return id;
}

export function takeConnectionHandoff(id: string): ChatGptConnection | null {
  if (!id) return null;
  const entry = entries.get(id);
  if (!entry) return null;

  // Single use, even when expired.
  entries.delete(id);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.connection;
}
