import { Suspense } from "react";
import type { Metadata } from "next";

import { AssessmentsListView } from "@/components/dashboard/assessments-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "My assessments" };

export default function AssessmentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
      <AssessmentsListView />
    </Suspense>
  );
}
