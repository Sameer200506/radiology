"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useAuth } from "@/components/auth/auth-provider";
import { isFirebaseConfigured, missingFirebaseEnvKeys } from "@/lib/firebase/client";
import { safeRedirectTarget } from "@/lib/security/access";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="MedAssist AI home">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-lg">
              <ActivityMark />
            </span>
            <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">MedAssist AI</span>
          </Link>
          <ThemeToggle />
        </div>

        <div className="glass-strong rounded-3xl p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-7 border-t border-line pt-6">{footer}</div> : null}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-subtle">
          By continuing you accept that this is an educational tool and not a medical service.{" "}
          <Link href="/disclaimer" className="underline underline-offset-4 hover:text-ink">
            Read the disclaimer
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function ActivityMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
      <path
        d="M3 12h4l3-8 4 16 3-8h4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Inline, dismissible form-level error. Always paired with aria-live. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 rounded-xl border border-critical/30 bg-critical/8 px-3.5 py-3 text-sm leading-relaxed text-ink"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-xl border border-good/30 bg-good/8 px-3.5 py-3 text-sm leading-relaxed text-ink"
    >
      <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
      {message}
    </p>
  );
}

/** Shared sign-in / sign-up form. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, ready, signInGoogle, signInEmail, signUpEmail } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"google" | "email" | null>(null);

  const redirectTo = safeRedirectTarget(searchParams.get("next"));
  const configured = isFirebaseConfigured();

  /**
   * Navigate once Firebase reports a signed-in user.
   *
   * Clearing `busy` here matters: sign-in succeeds, this effect runs, and the
   * navigation may take a moment — or bounce back here if the session cookie did
   * not survive. Leaving the button spinning through all of that told the user
   * nothing had happened while it was in fact mid-redirect.
   *
   * The attempt counter is a backstop against a redirect loop. The proxy sends
   * an authenticated-but-cookieless visitor from /dashboard back to
   * /login?next=/dashboard, which would re-trigger this effect indefinitely.
   * Rather than spinning forever, say what is actually wrong.
   */
  const attemptsRef = React.useRef(0);

  React.useEffect(() => {
    if (!ready || !user) {
      attemptsRef.current = 0;
      return;
    }

    setBusy(null);

    if (attemptsRef.current > 0) {
      setError(
        "You are signed in, but the browser could not keep the session. This usually means cookies are blocked for this site, or it is being opened over plain HTTP on a network address. Allow cookies for this site and try again.",
      );
      return;
    }

    attemptsRef.current += 1;
    router.replace(redirectTo);
  }, [ready, user, router, redirectTo, setBusy]);

  const runGoogle = async () => {
    setError(null);
    setBusy("google");
    const result = await signInGoogle();
    if (!result.ok) {
      setError(result.error ?? "Google sign-in failed. Please try again.");
      setBusy(null);
    }
  };

  const runEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setBusy("email");
    const result =
      mode === "login"
        ? await signInEmail(email.trim(), password)
        : await signUpEmail(email.trim(), password, displayName.trim());

    if (!result.ok) {
      setError(result.error ?? "That did not work. Please try again.");
      setBusy(null);
      return;
    }
    // On success the auth provider redirect takes over.
  };

  if (!configured) {
    const missing = missingFirebaseEnvKeys();
    const isHosted = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-caution/30 bg-caution-soft/40 p-4">
          <p className="text-sm font-medium text-ink">Authentication is not configured yet</p>

          {missing.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">
                Missing environment variables
              </p>
              <ul className="mt-1.5 space-y-1">
                {missing.map((key) => (
                  <li key={key} className="font-mono text-xs text-ink">
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 text-sm leading-relaxed text-muted">
            Follow the setup guide in the project README to add them.
          </p>

          {/*
            NEXT_PUBLIC_* values are inlined when the app is BUILT, not when it
            runs. On a host like Vercel, saving the variable is not enough: the
            deployment still holds the old bundle until it is rebuilt. Saying so
            here saves a long hunt, because the variable list looks correct in
            the dashboard while the deployed page still reports it missing.
          */}
          {isHosted ? (
            <p className="mt-3 rounded-xl border border-caution/30 bg-caution-soft/30 p-3 text-xs leading-relaxed text-ink">
              <strong className="font-semibold">These values are baked in at build time.</strong> If
              you have just added or changed them, you must redeploy for the new bundle to pick
              them up — saving the variable alone changes nothing.
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Then restart the dev server.
            </p>
          )}
        </div>
        <Button asChild variant="secondary" block>
          <Link href="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to the home page
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={runEmail} className="space-y-5" noValidate>
      <FormError message={error} />

      <button
        type="button"
        onClick={runGoogle}
        disabled={busy !== null}
        className={cn(
          "flex h-11 w-full items-center justify-center gap-3 rounded-full border border-line bg-surface/70 text-sm font-medium text-ink transition-colors",
          "hover:border-brand/40 hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        )}
      >
        {busy === "google" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <GoogleMark />
        )}
        Continue with Google
      </button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs uppercase tracking-[0.1em] text-subtle">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {mode === "signup" ? (
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-ink">
            Name
          </label>
          <Input
            id="displayName"
            name="name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Optional"
            maxLength={80}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-describedby="email-hint"
        />
        <p id="email-hint" className="text-xs text-subtle">
          Used to sign in. Never shared with the AI provider.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Password
          </label>
          {mode === "login" ? (
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-brand underline underline-offset-4"
            >
              Forgot password?
            </Link>
          ) : null}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={mode === "signup" ? "password-hint" : undefined}
        />
        {mode === "signup" ? (
          <p id="password-hint" className="text-xs text-subtle">
            At least 8 characters. Longer is better.
          </p>
        ) : null}
      </div>

      <Button type="submit" block size="lg" loading={busy === "email"} disabled={busy !== null}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.89Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.13A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.6H1.29a12 12 0 0 0 0 10.8l3.98-3.13Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.6l3.98 3.13C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}