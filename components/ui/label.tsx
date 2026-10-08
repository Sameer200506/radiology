"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils/cn";

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { asChild?: boolean }
>(function Label({ className, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : LabelPrimitive.Root;
  return (
    <Comp
      ref={ref}
      className={cn(
        "text-sm font-medium text-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});