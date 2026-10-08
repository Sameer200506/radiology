"use client";

/**
 * Browser-side authentication helpers.
 *
 * Wraps Firebase Auth so components never touch the SDK directly, and keeps the
 * session cookie in sync with the Firebase token on every token change — which
 * is what lets the server trust an httpOnly cookie without any polling.
 */

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase/client";

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Present when the caller may want to complete profile setup. */
  isNewUser?: boolean;
}

export interface AuthUserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function toUserInfo(user: User): AuthUserInfo {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/**
 * Turns Firebase error codes into messages a person can act on.
 * Never surfaces the raw SDK error string.
 */
function mapAuthError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: string }).code)
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "That email address does not look valid.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/weak-password":
      return "Choose a password with at least 8 characters.";
    case "auth/email-already-in-use":
      return "An account already exists with that email address. Try signing in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email address and password combination did not match an account.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a minute and try again.";
    case "auth/network-request-failed":
      return "Could not reach the sign-in service. Check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "The sign-in window was closed before completing.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with that email using a different sign-in method.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a minute and try again.";
    case "auth/operation-not-allowed":
      return "That sign-in method is not enabled for this project.";
    default:
      break;
  }

  // Network-layer failures never carry a Firebase code, so they fall through to
  // here. A timeout is distinguished from a hard failure because the remedy
  // differs: one is usually a blocked request, the other a wrong credential.
  if (/did not respond within/.test(String((error as { message?: string }).message ?? ""))) {
    return "We could not reach the sign-in service. Check your internet connection, then try again.";
  }

  if (code.startsWith("auth/") || code.startsWith("auth:")) {
    return "Something went wrong signing in. Please try again.";
  }

  return "Could not reach the sign-in service. Check your connection and try again.";
}

/**
 * Firebase's own promises have no timeout. If `identitytoolkit.googleapis.com` is
 * unreachable — corporate proxy, ad blocker, captive portal, DNS block — the
 * request can sit pending indefinitely, which showed up in the UI as a "Sign
 * in" button spinning forever with no message and nothing in the console.
 *
 * Wrapping every credential operation in a deadline converts that silence into
 * an actionable error. The user is told what to check instead of being left
 * staring at a spinner.
 */
const AUTH_TIMEOUT_MS = 20_000;

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Firebase ${label} did not respond within ${AUTH_TIMEOUT_MS / 1000}s.`,
              ),
            ),
          AUTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ensures `users/{uid}` exists so client-side writes have a profile to attach
 * to. Runs after sign-in; a failure is not surfaced because every screen falls
 * back to the Auth user when the profile read returns nothing.
 */
async function provisionProfile(user: User): Promise<void> {
  try {
    const { ensureUserProfile } = await import("@/lib/data");
    await ensureUserProfile(toUserInfo(user));
  } catch {
    // Firestore may still be loading, or the rules may be mid-deployment.
    // Non-fatal: the profile is provisioned again on the next sign-in.
  }
}

/** Pushes the current Firebase ID token into the httpOnly session cookie. */
async function syncSessionCookie(user: User | null): Promise<void> {
  try {
    if (!user) {
      await fetch("/api/auth/session", { method: "DELETE" });
      return;
    }
    const idToken = await user.getIdToken();
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    // A failed sync degrades the session, it does not break the UI. The next
    // onIdTokenChanged (one hour, or on any re-auth) retries.
  }
}

export function isAuthAvailable(): boolean {
  return isFirebaseConfigured() && getFirebase().auth !== null;
}

/** Subscribe to sign-in state. The cookie is refreshed on every token change. */
export function watchAuth(
  callback: (user: AuthUserInfo | null) => void,
): () => void {
  const { auth } = getFirebase();
  if (!auth) {
    callback(null);
    return () => undefined;
  }

  let active = true;

  const unsubscribe = onIdTokenChanged(
    auth,
    (user) => {
      if (!active) return;
      void syncSessionCookie(user);
      if (user) void provisionProfile(user);
      callback(user ? toUserInfo(user) : null);
    },
    () => {
      if (active) callback(null);
    },
  );

  return () => {
    active = false;
    unsubscribe();
  };
}

export async function signInWithGoogle(): Promise<AuthResult> {
  const { auth } = getFirebase();
  if (!auth) {
    return { ok: false, error: "Sign-in is not configured on this deployment." };
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await withTimeout(signInWithPopup(auth, provider), "Google sign-in");
    await syncSessionCookie(credential.user);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { auth } = getFirebase();
  if (!auth) {
    return { ok: false, error: "Sign-in is not configured on this deployment." };
  }
  try {
    const credential = await withTimeout(signInWithEmailAndPassword(auth, email, password), "sign-in");
    await syncSessionCookie(credential.user);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  const { auth } = getFirebase();
  if (!auth) {
    return { ok: false, error: "Sign-up is not configured on this deployment." };
  }
  try {
    const credential = await withTimeout(createUserWithEmailAndPassword(auth, email, password), "sign-up");
    if (displayName.trim().length > 0) {
      await updateProfile(credential.user, { displayName: displayName.trim() });
    }
    await syncSessionCookie(credential.user);
    return { ok: true, isNewUser: credential.user.emailVerified === false };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function sendReset(email: string): Promise<AuthResult> {
  const { auth } = getFirebase();
  if (!auth) {
    return { ok: false, error: "Password reset is not configured on this deployment." };
  }
  try {
    await withTimeout(sendPasswordResetEmail(auth, email), "password reset");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function signOutUser(): Promise<void> {
  const { auth } = getFirebase();
  if (!auth) return;
  await signOut(auth).catch(() => undefined);
  await syncSessionCookie(null);
}