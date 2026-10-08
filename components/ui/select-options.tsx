"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2.5", className)} {...props} />;
});

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectOptionListProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  name: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Single-choice list rendered as large, keyboard-navigable cards. */
export function SelectOptionList({
  value,
  onValueChange,
  options,
  name,
  disabled,
  invalid,
  className,
}: SelectOptionListProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      className={className}
      aria-invalid={invalid || undefined}
    >
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              "group flex cursor-pointer items-start gap-3 rounded-xl border bg-surface/60 px-4 py-3 transition-all",
              "hover:border-brand/45 hover:bg-brand/5",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
              value === option.value ? "border-brand bg-brand/8" : "border-line",
              disabled && "cursor-not-allowed opacity-60 hover:border-line hover:bg-surface/60",
            )}
          >
            <RadioGroupPrimitive.Item
              id={id}
              value={option.value}
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                "border-line-strong group-hover:border-brand/60",
                value === option.value ? "border-brand" : "border-line-strong",
              )}
            >
              <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-brand" />
            </RadioGroupPrimitive.Item>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

export interface MultiOptionListProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
  options: RadioOption[];
  name: string;
  disabled?: boolean;
  className?: string;
}

/** Multiple-choice list using real checkboxes so state is inspectable. */
export function MultiOptionList({
  values,
  onValuesChange,
  options,
  name,
  disabled,
  className,
}: MultiOptionListProps) {
  const toggle = (optionValue: string) => {
    if (values.includes(optionValue)) {
      onValuesChange(values.filter((v) => v !== optionValue));
    } else {
      onValuesChange([...values, optionValue]);
    }
  };

  return (
    <fieldset className={cn("grid gap-2.5", className)} disabled={disabled}>
      <legend className="sr-only">{name}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const checked = values.includes(option.value);
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              "group flex cursor-pointer items-start gap-3 rounded-xl border bg-surface/60 px-4 py-3 transition-all",
              "hover:border-brand/45 hover:bg-brand/5",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
              checked ? "border-brand bg-brand/8" : "border-line",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                checked ? "border-brand bg-brand text-white" : "border-line-strong group-hover:border-brand/60",
              )}
            >
              {checked ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <input
              id={id}
              type="checkbox"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => toggle(option.value)}
              disabled={disabled}
              className="sr-only"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}