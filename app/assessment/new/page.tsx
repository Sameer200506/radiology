import { Suspense } from "react";
import type { Metadata } from "next";

import { AssessmentWizard } from "@/components/assessment/wizard";
import { WizardProvider } from "@/components/assessment/wizard-store";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "New assessment",
  robots: { index: false, follow: false },
};

export default function NewAssessmentPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
        <WizardProvider>
          <AssessmentWizard />
        </WizardProvider>
      </Suspense>
    </div>
  );
}
