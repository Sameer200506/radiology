import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption for the ChatGPT connection cookie and the OAuth `state` value.
 *
 * Tokens never go into localStorage and never reach client JavaScript. They are
 * sealed with AES-256-GCM and stored in httpOnly cookies (or carried inside the
 * short-lived OAuth state). The key is derived from a server-only secret:
 *
 *   1. `AI_CONNECTION_SECRET` when set (recommended, so rotating an AI provider
 *      key does not force every user to reconnect).
 *   2. The Firebase service-account private key, if the Admin SDK is configured.
 *   3. The deployment's AI provider key, which is already a server-only secret.
 *
 * A deployment with none of those has no server secret at all, so the feature is
 * reported as unavailable rather than encrypted with a public value.
 */

const VERSION = "v1";
const KEY_SALT = "medassist-ai-chatgpt-connection-v1";
const DEV_SECRET = "medassist-local-development-only";

let cachedSecret: string | null = null;
let cachedKey: Buffer | null = null;

export class ConnectionCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionCryptoError";
  }
}

function readSecret(): string | null {
  const candidates = [
    process.env.AI_CONNECTION_SECRET,
    process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.OPENROUTER_API_KEY,
    process.env.GEMINI_API_KEY,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length >= 16) return value;
  }

  // Local development should work out of the box. Production must supply one of
  // the real secrets above; a fixed development key would make every deployment
  // share the same encryption key.
  if (process.env.NODE_ENV !== "production") return DEV_SECRET;

  return null;
}

function key(): Buffer {
  const secret = readSecret();
  if (!secret) {
    throw new ConnectionCryptoError(
      "No server secret is available to encrypt the ChatGPT connection. Set AI_CONNECTION_SECRET.",
    );
  }

  if (cachedKey && cachedSecret === secret) return cachedKey;

  cachedSecret = secret;
  cachedKey = scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

export function isConnectionCryptoAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function connectionCryptoUnavailableReason(): string | null {
  if (isConnectionCryptoAvailable()) return null;
  return "This deployment has no server secret available to protect a ChatGPT connection. Set AI_CONNECTION_SECRET.";
}

/** Encrypts a JSON-serialisable value. The AAD binds it to its purpose/owner. */
export function encryptJson(value: unknown, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Returns null for anything malformed, tampered with, or encrypted under
 * another key/AAD. Never throws at a call site that only needs a yes/no. */
export function decryptJson<T>(token: string, aad: string): T | null {
  try {
    const [version, ivPart, tagPart, dataPart] = token.split(".");
    if (version !== VERSION || !ivPart || !tagPart || !dataPart) return null;

    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}
