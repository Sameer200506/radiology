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
          "h-11 w-full rounded-xl border border-line/90 bg-surface/55 px-3.5 text-sm text-ink shadow-[inset_0_1px_2px_hsl(228_46%_10%/0.03)] backdrop-blur-md transition-all",
          "placeholder:text-subtle/90",
          "hover:border-line-strong/90 hover:bg-surface/70",
          "focus:border-brand/70 focus:bg-surface/85 focus:outline-none focus:ring-4 focus:ring-brand/12",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid &&
            "border-critical/60 focus:border-critical focus:ring-critical/12",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
