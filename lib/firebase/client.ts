"use client";

/**
 * Browser-side Firebase.
 *
 * Contains ONLY the publishable web config. No service account, no admin key,
 * no OpenRouter credential ever appears in this module or its import graph.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

import type { FirebaseClientConfig, FirebaseClientEnv, FirebaseEnvKey } from "@/types/firebase";

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const satisfies readonly FirebaseEnvKey[];

type RequiredKey = FirebaseEnvKey;

/**
 * Every value read through an explicit `process.env.NEXT_PUBLIC_*` literal.
 *
 * This must NOT be written as `process.env[key]` in a loop. Next.js replaces a
 * *literal* `process.env.NEXT_PUBLIC_FOO` member expression with the value at
 * build time, but a dynamic bracket lookup is not statically analysable and is
 * left as a runtime `process.env` access — which does not exist in the browser.
 * Reading the vars dynamically therefore returned undefined for every key, and
 * the app reported "Authentication is not configured yet" while the values were
 * sitting right there in the client bundle.
 *
 * Keeping the reads literal here also means the missing-key check below and the
 * config object are derived from the same source, so the two can never disagree.
 */
const ENV: Record<RequiredKey, string | undefined> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function readConfig(): FirebaseClientEnv {
  const missing: RequiredKey[] = REQUIRED_KEYS.filter((key) => !ENV[key]?.trim());

  if (missing.length > 0) {
    return { config: null, configured: false, missing: [...missing] };
  }

  const config: FirebaseClientConfig = {
    apiKey: ENV.NEXT_PUBLIC_FIREBASE_API_KEY as string,
    authDomain: ENV.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN as string,
    projectId: ENV.NEXT_PUBLIC_FIREBASE_PROJECT_ID as string,
    storageBucket: ENV.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: ENV.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: ENV.NEXT_PUBLIC_FIREBASE_APP_ID as string,
  };

  return { config, configured: true, missing: [] };
}

export function firebaseClientEnv(): FirebaseClientEnv {
  return readConfig();
}

/** Names of env vars that are still missing — used by the setup screen. */
export function missingFirebaseEnvKeys(): RequiredKey[] {
  return readConfig().missing;
}

let cached: {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  storage: FirebaseStorage | null;
} | null = null;

/**
 * Lazily initialised Firebase services.
 *
 * Returns nulls when the client env is incomplete so the app can render a setup
 * screen instead of throwing during module evaluation.
 */
export function getFirebase() {
  if (typeof window === "undefined") {
    return { app: null, auth: null, db: null, storage: null };
  }

  if (cached) return cached;

  const { config, configured } = readConfig();
  if (!configured || !config) {
    cached = { app: null, auth: null, db: null, storage: null };
    return cached;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  cached = { app, auth, db, storage };
  return cached;
}

export function isFirebaseConfigured(): boolean {
  return readConfig().configured;
}

/** Throws with a readable message if called before configuration is complete. */
export function requireFirebase() {
  const firebase = getFirebase();
  if (!firebase.auth || !firebase.db || !firebase.storage) {
    const { missing } = readConfig();
    throw new Error(
      `Firebase is not configured. Missing: ${missing.join(", ") || "unknown"}. See README.md → Firebase setup.`,
    );
  }
  return { auth: firebase.auth, db: firebase.db, storage: firebase.storage };
}