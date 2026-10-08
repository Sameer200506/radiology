"use client";

import * as React from "react";
import type { AuthUserInfo } from "@/lib/auth/client";
import {
  isAuthAvailable,
  signInWithEmail as signInEmailRaw,
  signInWithGoogle as signInGoogleRaw,
  signUpWithEmail as signUpEmailRaw,
  watchAuth,
  type AuthResult,
} from "@/lib/auth/client";

interface AuthContextValue {
  user: AuthUserInfo | null;
  /** False until the first auth state resolution completes. */
  ready: boolean;
  /** True when Firebase client env vars are present. */
  available: boolean;
  signInGoogle: () => Promise<AuthResult>;
  signInEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpEmail: (email: string, password: string, displayName: string) => Promise<AuthResult>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/**
 * Tracks Firebase sign-in state and keeps the httpOnly session cookie in sync.
 *
 * When Firebase is not configured the resolved state is known synchronously from
 * the environment, so `ready` starts as true rather than being flipped from an
 * effect. That avoids a cascading render on a page that can never sign in.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const available = React.useMemo(() => isAuthAvailable(), []);
  const [user, setUser] = React.useState<AuthUserInfo | null>(null);
  const [ready, setReady] = React.useState(!available);

  React.useEffect(() => {
    if (!available) return;

    const unsubscribe = watchAuth((nextUser) => {
      setUser(nextUser);
      setReady(true);
    });

    return unsubscribe;
  }, [available]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      available,
      signInGoogle: () => signInGoogleRaw(),
      signInEmail: (email, password) => signInEmailRaw(email, password),
      signUpEmail: (email, password, displayName) => signUpEmailRaw(email, password, displayName),
    }),
    [user, ready, available],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}