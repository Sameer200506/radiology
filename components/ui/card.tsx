"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const cardVariants = cva("relative rounded-3xl", {
  variants: {
    variant: {
      glass: "glass",
      "glass-strong": "glass-strong",
      "glass-subtle": "glass-subtle",
      solid: "bg-surface border border-line",
      outline: "border border-line bg-transparent",
      gradient:
        "border border-transparent bg-gradient-to-br from-brand/12 via-accent/10 to-transparent backdrop-blur-xl border-brand/15",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-5 sm:p-6",
      lg: "p-6 sm:p-8",
    },
    hover: {
      none: "",
      lift: "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] hover:border-brand/30",
    },
  },
  defaultVariants: {
    variant: "glass",
    padding: "md",
    hover: "none",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, padding, hover, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding, hover }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold tracking-tight text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-relaxed text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-5 flex items-center gap-3", className)} {...props} />;
}

export { cardVariants };