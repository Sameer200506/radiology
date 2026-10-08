"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-white shadow-[0_8px_24px_-10px_hsl(var(--brand)/0.8)] hover:bg-brand-strong hover:shadow-[0_12px_32px_-10px_hsl(var(--brand)/0.9)]",
        secondary:
          "glass text-ink hover:border-brand/40 hover:bg-brand/5",
        outline:
          "border border-line-strong bg-transparent text-ink hover:bg-brand/8 hover:border-brand/40",
        ghost: "text-muted hover:bg-brand/8 hover:text-ink",
        danger:
          "bg-critical text-white hover:opacity-90 shadow-[0_8px_24px_-10px_hsl(var(--critical)/0.8)]",
        link: "text-brand underline-offset-4 hover:underline p-0 h-auto rounded-none",
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