import type { Metadata } from "next";

import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "Understand Your Health Information With AI-Assisted Analysis",
};

export default function HomePage() {
  return <LandingPage />;
}
