import type { Metadata } from "next";

import { MarketingFooter, MarketingHeader } from "@/components/layout/marketing-chrome";

export const metadata: Metadata = {
  title: { default: "MedAssist AI", template: "%s · MedAssist AI" },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <div className="flex-1">{children}</div>
      <MarketingFooter />
    </div>
  );
}