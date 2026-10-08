import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · MedAssist AI" },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <AppShell>{children}</AppShell>
    </div>
  );
}
