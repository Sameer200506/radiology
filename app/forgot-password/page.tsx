import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-24 h-96 max-w-md rounded-3xl" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
