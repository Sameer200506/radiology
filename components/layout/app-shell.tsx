"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { signOutUser } from "@/lib/auth/client";
import { useAuth } from "@/components/auth/auth-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/assessment/new", label: "New assessment", icon: PlusCircle, exact: false },
  { href: "/dashboard/assessments", label: "My assessments", icon: Activity, exact: false },
  { href: "/dashboard/reports", label: "Reports", icon: FileText, exact: false },
  { href: "/dashboard/profile", label: "Profile", icon: User, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
] as const;

const PRIMARY_NAV = NAV.slice(0, 3);
const SECONDARY_NAV = NAV.slice(3);

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name?: string | null, email?: string | null): string {
  const source = (name ?? email ?? "MA").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "M").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  // Close the mobile drawer whenever navigation happens.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleSignOut = React.useCallback(async () => {
    setSigningOut(true);
    await signOutUser();
    router.replace("/login");
  }, [router]);

  const current = NAV.find((item) => isActive(pathname, item.href, item.exact));

  const navLink = (item: (typeof NAV)[number]) => {
    const active = isActive(pathname, item.href, item.exact);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300",
          active ? "font-medium text-ink" : "text-muted hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/[0.05]",
        )}
      >
        {active ? (
          <motion.span
            layoutId="nav-active"
            className="absolute inset-0 -z-10 rounded-xl border border-brand/20 bg-gradient-to-r from-brand/15 via-brand/10 to-accent/[0.08] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_8px_20px_-12px_hsl(var(--brand)/0.6)]"
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden="true"
          />
        ) : null}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
            active
              ? "border-brand/25 bg-brand/15 text-brand"
              : "border-line/60 bg-surface/35 text-subtle group-hover:text-ink",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="flex-1">{item.label}</span>
        {active ? <span className="size-1.5 rounded-full bg-brand shadow-[0_0_8px_hsl(var(--brand)/0.8)]" /> : null}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link href="/dashboard" className="group flex items-center gap-3 px-1 pt-1">
        <span className="relative flex size-10 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-brand via-brand to-accent text-white shadow-[0_10px_26px_-10px_hsl(var(--brand)/0.9),inset_0_1px_0_hsl(0_0%_100%/0.35)]">
          <Activity className="size-[1.15rem]" strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.9375rem] font-semibold leading-tight tracking-tight text-ink">
            MedAssist AI
          </span>
          <span className="mt-0.5 block text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-subtle">
            Clinical workspace
          </span>
        </span>
      </Link>

      <div className="glass-inset flex items-center gap-3 rounded-2xl p-2.5">
        <Avatar className="size-9">
          {user?.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
          <AvatarFallback>{initials(user?.displayName, user?.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {user?.displayName || "Your account"}
          </p>
          <p className="truncate text-xs text-subtle">{user?.email ?? "Private workspace"}</p>
        </div>
        <span className="flex size-2 rounded-full bg-good shadow-[0_0_8px_hsl(var(--good)/0.8)]" aria-hidden="true" />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto">
        <p className="px-3 pb-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-subtle/80">
          Workspace
        </p>
        <ul className="space-y-1">{PRIMARY_NAV.map(navLink)}</ul>

        <p className="px-3 pb-2 pt-6 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-subtle/80">
          Account
        </p>
        <ul className="space-y-1">{SECONDARY_NAV.map(navLink)}</ul>
      </nav>

      <div className="space-y-3">
        <div className="glass-inset rounded-2xl p-3.5">
          <div className="flex items-center gap-2 text-ink">
            <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
            <p className="text-xs font-semibold">Private by default</p>
          </div>
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-subtle">
            Your uploads and assessments are visible only to your account.
          </p>
        </div>

        <ThemeToggle compact className="w-full" />

        <Separator className="bg-line/60" />

        <Button
          variant="ghost"
          onClick={handleSignOut}
          loading={signingOut}
          className="w-full justify-start gap-3 px-3 text-muted"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </Button>

        <p className="px-1 text-[0.625rem] leading-relaxed text-subtle/80">
          Educational decision support. Not a diagnostic device.
        </p>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-3 left-3 z-30 hidden w-[276px] lg:block">
        <div className="glass-strong glass-rule flex h-full flex-col overflow-hidden rounded-[2rem]">
          {sidebar}
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" hideClose={false} className="p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="lg:pl-[300px]">
        <header className="sticky top-0 z-20 px-3 pt-3 sm:px-4 lg:px-6">
          <div className="glass mx-auto flex w-full max-w-6xl items-center gap-2 rounded-2xl px-2.5 py-2 sm:gap-3 sm:px-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-xl p-2 text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="hidden size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white sm:flex lg:hidden">
                <Activity className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-ink">
                  {current?.label ?? "MedAssist AI"}
                </p>
                <p className="hidden truncate text-[0.6875rem] text-subtle sm:block">
                  Workspace · Private and encrypted in transit
                </p>
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <ThemeToggle compact />
            </div>

            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/assessment/new">
                <Sparkles className="size-3.5" aria-hidden="true" />
                New assessment
              </Link>
            </Button>

            <Link
              href="/dashboard/profile"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              aria-label="Open profile"
            >
              <Avatar className="size-9">
                {user?.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
                <AvatarFallback>{initials(user?.displayName, user?.email)}</AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <Link
        href="/assessment/new"
        className="fixed bottom-4 right-4 z-30 flex size-14 items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-brand to-brand-strong text-white shadow-[0_16px_40px_-12px_hsl(var(--brand)/0.85),inset_0_1px_0_hsl(0_0%_100%/0.35)] transition-transform hover:scale-105 sm:hidden"
        aria-label="Start a new assessment"
      >
        <PlusCircle className="size-6" aria-hidden="true" />
      </Link>
    </div>
  );
}
