"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  [
    "group/button relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium",
    "transition-all duration-300 disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:scale-[0.975] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  ],
  {
    variants: {
      variant: {
        primary:
          "border border-white/15 bg-gradient-to-b from-brand to-brand-strong text-white shadow-[0_1px_0_0_hsl(0_0%_100%/0.25)_inset,0_14px_32px_-14px_hsl(var(--brand)/0.75)] hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.3)_inset,0_20px_40px_-16px_hsl(var(--brand)/0.85)] hover:brightness-105",
        secondary:
          "glass text-ink hover:border-brand/35 hover:bg-brand/[0.07] hover:shadow-[var(--shadow-lift)]",
        outline:
          "border border-line-strong/80 bg-surface/30 text-ink backdrop-blur-md hover:border-brand/45 hover:bg-brand/[0.07]",
        ghost:
          "text-muted hover:bg-ink/[0.05] hover:text-ink dark:hover:bg-white/[0.06]",
        danger:
          "border border-white/15 bg-gradient-to-b from-critical to-[hsl(var(--critical)/0.82)] text-white shadow-[0_1px_0_0_hsl(0_0%_100%/0.2)_inset,0_14px_30px_-14px_hsl(var(--critical)/0.7)] hover:brightness-105",
        link: "h-auto rounded-none p-0 text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-4 text-[0.8125rem]",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-[0.9375rem]",
        icon: "size-10 p-0",
        "icon-sm": "size-8 p-0",
      },
      block: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Announced to screen readers while the button is in a loading state. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, block, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);

export { buttonVariants };
