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
  User,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { signOutUser } from "@/lib/auth/client";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/assessment/new", label: "New Assessment", icon: PlusCircle, exact: false },
  { href: "/dashboard/assessments", label: "My Assessments", icon: Activity, exact: false },
  { href: "/dashboard/reports", label: "Reports", icon: FileText, exact: false },
  { href: "/dashboard/profile", label: "Profile", icon: User, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [drawer, setDrawer] = React.useState<{ open: boolean; forPath: string }>({
    open: false,
    forPath: pathname,
  });
  const [signingOut, setSigningOut] = React.useState(false);

  // Close the mobile drawer whenever navigation happens. Deriving this during
  // render (React's documented "adjust state when props change" pattern) avoids
  // an effect that would render the stale drawer for one frame.
  if (drawer.forPath !== pathname) {
    setDrawer({ open: false, forPath: pathname });
  }
  const open = drawer.open;

  const closeDrawer = React.useCallback(() => {
    setDrawer((current) => ({ ...current, open: false }));
  }, []);

  const openDrawer = React.useCallback(() => {
    setDrawer((current) => ({ open: true, forPath: current.forPath }));
  }, []);

  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleSignOut = React.useCallback(async () => {
    setSigningOut(true);
    await signOutUser();
    router.replace("/login");
  }, [router]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-5">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
        <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-lg">
          <Activity className="size-5" strokeWidth={2.4} />
        </span>
        <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">MedAssist AI</span>
      </Link>

      <nav aria-label="Main" className="flex-1">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                    active ? "font-medium text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 -z-10 rounded-xl border border-brand/25 bg-brand/10"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <Icon
                    className={cn("size-[1.05rem] shrink-0", active ? "text-brand" : "text-subtle")}
                    aria-hidden="true"
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-3 border-t border-line pt-4">
        <ThemeToggle className="w-full justify-start gap-3 px-3 py-2.5" />
        <Button
          variant="ghost"
          onClick={handleSignOut}
          loading={signingOut}
          className="w-full justify-start gap-3 px-3"
        >
          <LogOut className="size-[1.05rem]" aria-hidden="true" />
          Sign out
        </Button>
        <p className="px-1 text-[0.6875rem] leading-relaxed text-subtle">
          Educational decision support. Not a diagnostic device.
        </p>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-line/70 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDrawer}
              className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="glass-strong fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] lg:hidden"
            >
              <button
                type="button"
                onClick={closeDrawer}
                className="absolute right-3 top-4 rounded-full p-2 text-muted hover:bg-muted/10 hover:text-ink"
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
              {sidebar}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-[264px]">
        <header className="glass sticky top-0 z-20 flex items-center gap-3 border-b border-line/60 px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={openDrawer}
            className="rounded-xl p-2 text-muted transition-colors hover:bg-muted/10 hover:text-ink"
            aria-label="Open navigation"
            aria-expanded={open}
          >
            <Menu className="size-5" />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white">
              <Activity className="size-4" strokeWidth={2.4} />
            </span>
            <span className="text-sm font-semibold text-ink">MedAssist AI</span>
          </Link>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}