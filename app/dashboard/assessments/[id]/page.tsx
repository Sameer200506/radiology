import type { Metadata } from "next";

import { StoredAssessmentClient } from "@/components/dashboard/stored-assessment-client";

export const metadata: Metadata = {
  title: "Assessment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StoredAssessmentPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="space-y-8">
      <StoredAssessmentClient assessmentId={id} />
    </div>
  );
}