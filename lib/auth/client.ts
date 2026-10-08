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
      return "Something went wrong signing in. Please try again.";
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
    const credential = await signInWithPopup(auth, provider);
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
    const credential = await signInWithEmailAndPassword(auth, email, password);
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
    const credential = await createUserWithEmailAndPassword(auth, email, password);
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
    await sendPasswordResetEmail(auth, email);
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