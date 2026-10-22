"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const cardVariants = cva("relative rounded-[1.75rem]", {
  variants: {
    variant: {
      glass: "glass",
      "glass-strong": "glass-strong",
      "glass-subtle": "glass-subtle",
      solid: "border border-line/80 bg-surface/90 shadow-[var(--shadow-glass)]",
      outline: "border border-line/80 bg-transparent",
      gradient:
        "glass border-brand/20 bg-gradient-to-br from-brand/[0.1] via-accent/[0.07] to-transparent",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-5 sm:p-6",
      lg: "p-6 sm:p-8",
    },
    hover: {
      none: "",
      lift: "spotlight transition-all duration-300 hover:-translate-y-1 hover:border-brand/25 hover:shadow-[var(--shadow-lift)]",
      glow: "transition-all duration-300 hover:border-brand/30 hover:shadow-[var(--shadow-glow)]",
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
  return (
    <h3 className={cn("text-base font-semibold tracking-tight text-ink", className)} {...props} />
  );
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
