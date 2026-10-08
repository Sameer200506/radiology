import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard, AuthForm } from "@/components/auth/auth-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-24 h-96 max-w-md rounded-3xl" />}>
      <AuthCard
        title="Create your account"
        subtitle="An account keeps your uploads and assessments separate from anyone else's, and lets you delete them at any time."
        footer={
          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand underline underline-offset-4">
              Sign in
            </Link>
          </p>
        }
      >
        <AuthForm mode="signup" />
      </AuthCard>
    </Suspense>
  );
}
