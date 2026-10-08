import type { Metadata } from "next";

import { ReportsListView } from "@/components/dashboard/reports-list";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsListView />;
}
