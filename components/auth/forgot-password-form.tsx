"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuthCard, FormError, FormSuccess } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import { sendReset } from "@/lib/auth/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const configured = isFirebaseConfigured();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    setBusy(true);
    const result = await sendReset(email.trim());
    setBusy(false);

    if (result.ok) {
      setSent(true);
      return;
    }
    setError(result.error ?? "The reset email could not be sent. Please try again.");
  };

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will email you a link to choose a new password."
      footer={
        <p className="text-center text-sm text-muted">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-medium text-brand underline underline-offset-4"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to sign in
          </Link>
        </p>
      }
    >
      {!configured ? (
        <div className="rounded-2xl border border-caution/30 bg-caution-soft/40 p-4 text-sm leading-relaxed text-muted">
          Password reset is not available until the Firebase environment variables are configured.
          See the setup guide in the project README.
        </div>
      ) : sent ? (
        <div className="space-y-5">
          <FormSuccess
            message="If an account exists with that email address, a reset link is on its way. Check your spam folder if it does not arrive within a few minutes."
          />
          <Button asChild variant="secondary" block>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <FormError message={error} />

          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium text-ink">
              Email address
            </label>
            <Input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <Button type="submit" block size="lg" loading={busy}>
            Send reset link
          </Button>

          <p className="text-xs leading-relaxed text-subtle">
            For your privacy, this page does not confirm whether an account exists.
          </p>
        </form>
      )}
    </AuthCard>
  );
}