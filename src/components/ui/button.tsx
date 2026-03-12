import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const variants = {
  default:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-primary/40",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-primary/20",
  ghost:
    "bg-transparent text-foreground hover:bg-foreground/6 focus-visible:ring-primary/20",
  outline:
    "border border-border bg-white/30 text-foreground hover:bg-white/60 dark:bg-white/5 dark:hover:bg-white/10 focus-visible:ring-primary/20",
  destructive:
    "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/30",
} as const;

const sizes = {
  default: "h-11 px-4 py-2 text-sm",
  sm: "h-9 rounded-[1.1rem] px-3 text-sm",
  lg: "h-12 rounded-[1.4rem] px-5 text-sm",
  icon: "size-11 rounded-[1.4rem] p-0",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[1.4rem] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
