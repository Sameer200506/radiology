"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, hint, id, rows = 5, ...props },
  ref,
) {
  const generatedId = React.useId();
  const textareaId = id ?? generatedId;
  const hintId = hint ? `${textareaId}-hint` : undefined;

  return (
    <div className="w-full">
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(
          "w-full resize-y rounded-xl border border-line/90 bg-surface/55 px-3.5 py-3 text-sm leading-relaxed text-ink shadow-[inset_0_1px_2px_hsl(228_46%_10%/0.03)] backdrop-blur-md transition-all",
          "placeholder:text-subtle/90",
          "hover:border-line-strong/90 hover:bg-surface/70",
          "focus:border-brand/70 focus:bg-surface/85 focus:outline-none focus:ring-4 focus:ring-brand/12",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid && "border-critical/60 focus:border-critical focus:ring-critical/12",
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
