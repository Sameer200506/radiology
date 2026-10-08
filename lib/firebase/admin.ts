/**
 * Server-side Firebase Admin.
 *
 * This module is server-only. It is imported by Route Handlers, Server
 * Components and `proxy.ts` — never by a Client Component. The service account
 * private key lives in the environment and never leaves the server.
 *
 * ## Verification modes
 *
 * 1. **Service account present** (`FIREBASE_SERVICE_ACCOUNT_JSON`, or the
 *    individual `FIREBASE_ADMIN_*` variables). Preferred: enables full session
 *    cookie verification, Firestore Admin access and Storage Admin access.
 *
 * 2. **Client config only.** Auth can still run in the browser and Route Handlers
 *    can verify ID tokens with `verifyIdToken` using the public web API, but
 *    server-side Firestore/Storage access is unavailable. See README for the
 *    trade-offs. In this mode `getAdminDb()` returns null and callers fall back
 *    to client SDK reads, which are still protected by Firestore Security Rules.
 */

import "server-only";

import { initializeApp, getApps, cert, applicationDefault, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage as AdminStorage } from "firebase-admin/storage";

export interface AdminAvailability {
  firestore: boolean;
  storage: boolean;
  auth: boolean;
  /** True when the service account is missing, so we can show a setup banner. */
  degraded: boolean;
}

let cachedApp: App | null = null;
let cachedReason: string | null = null;
// Once a credential is found and fails, we stop retrying rather than logging on
// every request. Set to false only by getAdminApp() succeeding.
let credentialChecked = false;

function readServiceAccount(): Record<string, string> | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, string>;
      if (typeof parsed.project_id === "string" && typeof parsed.private_key === "string") {
        // Environment variables frequently mangle newlines in private keys.
        return {
          ...parsed,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      cachedReason = "FIREBASE_SERVICE_ACCOUNT_JSON is present but is not valid JSON.";
    }
    return null;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

/**
 * Decides whether the Admin SDK can realistically initialise.
 *
 * Checked BEFORE calling `initializeApp` because `applicationDefault()` does not
 * fail cleanly when there are no ambient credentials: it throws asynchronously,
 * surfacing as `unhandledRejection` (which can terminate a Node process) rather
 * than as a catchable error at the call site. Probing for a usable credential
 * first keeps the degraded path silent and deterministic.
 */
function hasUsableAdminCredential(): boolean {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      JSON.parse(json);
      return true;
    } catch {
      return false;
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();
  if (projectId && clientEmail && privateKey) return true;

  // GOOGLE_APPLICATION_CREDENTIALS is the other documented way to supply a
  // service account to the Admin SDK.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;

  return false;
}

function getAdminApp(): App | null {
  if (cachedApp) return cachedApp;

  if (getApps().length > 0) {
    cachedApp = getApps()[0] as App;
    return cachedApp;
  }

  if (!hasUsableAdminCredential()) {
    // Report once, then stay quiet.
    if (!credentialChecked) {
      cachedReason =
        "No Firebase Admin credential found. Set FIREBASE_SERVICE_ACCOUNT_JSON, the FIREBASE_ADMIN_* variables, or GOOGLE_APPLICATION_CREDENTIALS.";
      credentialChecked = true;
      console.warn(`[firebase] Admin SDK disabled: ${cachedReason}`);
    }
    return null;
  }
  credentialChecked = false;

  const serviceAccount = readServiceAccount();

  try {
    if (serviceAccount) {
      cachedApp = initializeApp({
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
        projectId: serviceAccount.project_id,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined,
      });
      return cachedApp;
    }

    // Only reached when GOOGLE_APPLICATION_CREDENTIALS points at a valid file,
    // so `applicationDefault()` here is safe to call synchronously.
    cachedApp = initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
    return cachedApp;
  } catch (error) {
    cachedReason = error instanceof Error ? error.message : "unknown error initialising Admin SDK";
    return null;
  }
}

export function adminStatus(): AdminAvailability {
  const app = getAdminApp();
  if (!app) {
    return { firestore: false, storage: false, auth: false, degraded: true };
  }
  return { firestore: true, storage: true, auth: true, degraded: false };
}

export function adminInitError(): string | null {
  getAdminApp();
  return cachedReason;
}

export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminDb(): Firestore | null {
  const app = getAdminApp();
  return app ? getFirestore(app) : null;
}

export function getAdminStorage(): AdminStorage | null {
  const app = getAdminApp();
  return app ? getStorage(app) : null;
}

/** True when the Admin SDK is usable for privileged operations. */
export function hasAdminCredentials(): boolean {
  return getAdminApp() !== null;
}

/** Uniform ISO timestamp for Firestore writes. */
export function nowIso(): string {
  return new Date().toISOString();
}