"use client";

import { useSearchParams } from "next/navigation";

import { AssessmentWizard } from "@/components/assessment/wizard";
import { WizardProvider } from "@/components/assessment/wizard-store";

export function NewAssessmentClient() {
  const params = useSearchParams();
  const draftId = params.get("draft") ?? undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <WizardProvider initialAssessmentId={draftId}>
        <AssessmentWizard />
      </WizardProvider>
    </div>
  );
}
