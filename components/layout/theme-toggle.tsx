"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** No-op subscription: we only need to know whether hydration has happened. */
const subscribe = () => () => undefined;

/**
 * `useSyncExternalStore` is the supported way to detect hydration. It returns
 * false during the server render and the first client render, then true, without
 * a setState-in-effect that would cause a cascading render.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const hydrated = useHydrated();

  // Before hydration the DOM has not been painted yet, so we render the neutral
  // default and avoid a mismatch between server HTML and the first client render.
  const selected = hydrated ? (theme ?? "system") : "system";
  const effective = hydrated ? (theme === "system" ? (resolvedTheme ?? "system") : theme) : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-line bg-surface/60 p-1",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            title={`${option.label} theme`}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-all",
              isSelected ? "bg-brand/12 text-brand" : "text-subtle hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{option.label}</span>
            {effective === option.value ? <span className="sr-only">(active)</span> : null}
          </button>
        );
      })}
    </div>
  );
}