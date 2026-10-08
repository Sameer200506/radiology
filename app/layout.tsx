import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { Providers } from "@/components/providers";
import { AuthProvider } from "@/components/auth/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "MedAssist AI — Understand Your Health Information",
    template: "%s · MedAssist AI",
  },
  description:
    "MedAssist AI turns the reports and images you upload, plus the symptoms you describe, into a structured, carefully hedged health-information summary you can take to a healthcare professional. Educational decision support, not a diagnosis.",
  applicationName: "MedAssist AI",
  keywords: [
    "medical report summary",
    "symptom checker",
    "health information",
    "lab results explained",
    "clinical decision support",
  ],
  authors: [{ name: "MedAssist AI" }],
  openGraph: {
    type: "website",
    title: "MedAssist AI — Understand Your Health Information",
    description:
      "Upload your reports, describe your symptoms, and receive a structured AI-generated health assessment. Not a diagnosis.",
    siteName: "MedAssist AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "MedAssist AI",
    description: "AI-assisted medical information, carefully hedged. Not a diagnosis.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1017" },
  ],
};

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "MedAssist AI",
  applicationCategory: "HealthApplication",
  operatingSystem: "Web",
  description:
    "Educational clinical decision-support sandbox that summarises user-uploaded medical reports and symptom descriptions. It does not diagnose.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Symptom intake with dynamic follow-up questions",
    "PDF laboratory and radiology report transcription",
    "Deterministic red-flag triage layer",
    "Structured, hedged health-information summary",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script
          type="application/ld+json"
          // Static, developer-authored JSON-LD. No user data is embedded.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <div className="aurora" aria-hidden="true" />
        <div className="grid-texture pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
      </body>
    </html>
  );
}