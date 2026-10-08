"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Rendered under the field; linked with aria-describedby automatically. */
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, hint, id, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(
          "h-11 w-full rounded-xl border bg-surface/70 px-3.5 text-sm text-ink transition-colors",
          "placeholder:text-subtle",
          "focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/12",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid ? "border-critical/60 focus:border-critical focus:ring-critical/12" : "border-line",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});