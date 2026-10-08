import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard, AuthForm } from "@/components/auth/auth-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-24 h-96 max-w-md rounded-3xl" />}>
      <AuthCard
        title="Sign in to MedAssist AI"
        subtitle="Your assessments, uploads and reports are private to your account."
        footer={
          <p className="text-center text-sm text-muted">
            New here?{" "}
            <Link href="/signup" className="font-medium text-brand underline underline-offset-4">
              Create an account
            </Link>
          </p>
        }
      >
        <AuthForm mode="login" />
      </AuthCard>
    </Suspense>
  );
}
