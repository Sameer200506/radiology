import Link from "next/link";
import { Activity, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/faq", label: "FAQ" },
  { href: "/disclaimer", label: "Disclaimer" },
] as const;

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/50 glass">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="MedAssist AI home">
          <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-lg">
            <Activity className="size-5" strokeWidth={2.4} />
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">MedAssist AI</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm text-muted transition-colors hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden h-9 items-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:text-ink sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/assessment/new"
            className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-medium text-white shadow-[0_8px_24px_-10px_hsl(var(--brand)/0.8)] transition-colors hover:bg-brand-strong"
          >
            Start
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-24 border-t border-line/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white">
                <Activity className="size-4" strokeWidth={2.4} />
              </span>
              <span className="text-sm font-semibold text-ink">MedAssist AI</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              An educational clinical decision-support sandbox. It helps you organise information
              you already have so you can have a better conversation with a healthcare professional.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <h2 className="eyebrow">Product</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-muted transition-colors hover:text-ink">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="eyebrow">Account</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/login" className="text-muted transition-colors hover:text-ink">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/signup" className="text-muted transition-colors hover:text-ink">
                    Create account
                  </Link>
                </li>
                <li>
                  <Link href="/assessment/new" className="text-muted transition-colors hover:text-ink">
                    New assessment
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h2 className="eyebrow">Trust</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-start gap-1.5 text-muted">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
                  Safety layer runs before any AI
                </li>
                <li className="flex items-start gap-1.5 text-muted">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
                  No medication advice
                </li>
                <li className="flex items-start gap-1.5 text-muted">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
                  Private by default
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 rounded-2xl border border-caution/25 bg-caution-soft/30 p-4">
          <p className="text-xs leading-relaxed text-muted">
            <strong className="font-semibold text-ink">Medical disclaimer.</strong> MedAssist AI is
            an automated decision-support tool for education. It is not a doctor, not a diagnostic
            device, and not a substitute for professional medical advice, diagnosis or treatment. It
            can produce incorrect or incomplete output. In an emergency, contact your local
            emergency number or go to your nearest emergency department. Never delay emergency care
            to use this application.
          </p>
        </div>

        <p className="mt-6 text-xs text-subtle">
          © {new Date().getFullYear()} MedAssist AI. Built as an educational project.
        </p>
      </div>
    </footer>
  );
}