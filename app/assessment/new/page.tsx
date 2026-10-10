import { Suspense } from "react";
import type { Metadata } from "next";

import { NewAssessmentClient } from "@/app/assessment/new/new-assessment-client";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "New assessment",
  robots: { index: false, follow: false },
};

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-8 h-96 w-full max-w-3xl rounded-3xl" />}>
      <NewAssessmentClient />
    </Suspense>
  );
}
