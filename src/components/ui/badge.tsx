import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const variants = {
  neutral: "bg-foreground/6 text-foreground",
  success: "bg-success/14 text-success",
  warning: "bg-warning/14 text-warning",
  danger: "bg-danger/14 text-danger",
  info: "bg-primary/14 text-primary",
} as const;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
