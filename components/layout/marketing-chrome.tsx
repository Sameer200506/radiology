import Link from "next/link";
import { Activity, ArrowUpRight, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Badge } from "@/components/ui/badge";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/faq", label: "FAQ" },
  { href: "/disclaimer", label: "Disclaimer" },
] as const;

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
      <div className="glass glass-rule mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 rounded-2xl px-3 sm:px-4">
        <Link href="/" className="group flex items-center gap-3" aria-label="MedAssist AI home">
          <span className="relative flex size-10 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-brand via-brand to-accent text-white shadow-[0_10px_26px_-10px_hsl(var(--brand)/0.9),inset_0_1px_0_hsl(0_0%_100%/0.35)] transition-transform duration-300 group-hover:scale-105">
            <Activity className="size-[1.15rem]" strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[0.9375rem] font-semibold leading-tight tracking-tight text-ink">
              MedAssist AI
            </span>
            <span className="hidden text-[0.625rem] font-medium uppercase tracking-[0.16em] text-subtle sm:block">
              Understand your health information
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm text-muted transition-colors",
                "hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/[0.05]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <ThemeToggle compact />
          </div>
          <Link
            href="/login"
            className="hidden h-9 items-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-ink/[0.04] hover:text-ink sm:inline-flex dark:hover:bg-white/[0.05]"
          >
            Sign in
          </Link>
          <Link
            href="/assessment/new"
            className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-gradient-to-b from-brand to-brand-strong px-4 text-sm font-medium text-white shadow-[0_1px_0_0_hsl(0_0%_100%/0.25)_inset,0_10px_24px_-12px_hsl(var(--brand)/0.8)] transition-all hover:brightness-105"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Start
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-24 px-3 pb-4 sm:px-4">
      <div className="glass glass-rule mx-auto w-full max-w-6xl rounded-[2rem] p-6 sm:p-9">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-brand to-accent text-white shadow-[0_8px_20px_-10px_hsl(var(--brand)/0.8)]">
                <Activity className="size-5" strokeWidth={2.4} aria-hidden="true" />
              </span>
              <div>
                <span className="block text-sm font-semibold text-ink">MedAssist AI</span>
                <span className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-subtle">
                  Educational decision support
                </span>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              An educational clinical decision-support sandbox. It helps you organise information
              you already have so you can have a better conversation with a healthcare professional.
            </p>
            <Badge tone="brand" size="sm" className="mt-4">
              <ShieldCheck className="size-3" aria-hidden="true" />
              Private by default
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <h2 className="eyebrow">Product</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex items-center gap-1 text-muted transition-colors hover:text-ink"
                    >
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
                  <Link
                    href="/assessment/new"
                    className="inline-flex items-center gap-1 text-muted transition-colors hover:text-ink"
                  >
                    New assessment
                    <ArrowUpRight className="size-3" aria-hidden="true" />
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

        <div className="mt-10 rounded-2xl border border-caution/25 bg-caution-soft/30 p-4 backdrop-blur-sm">
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
