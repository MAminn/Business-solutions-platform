import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground border border-border/60",
        outline: "border border-border text-foreground",
        success: "bg-success/15 text-emerald-400 border border-emerald-500/20",
        info: "bg-info/15 text-cyan-400 border border-cyan-500/20",
        warning: "bg-warning/15 text-amber-400 border border-amber-500/20",
        destructive: "bg-destructive/15 text-red-400 border border-red-500/20",
        muted: "bg-muted text-muted-foreground border border-border/60",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  withDot?: boolean;
}

export function Badge({ className, variant, withDot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {withDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-emerald-400": variant === "success",
            "bg-cyan-400": variant === "info",
            "bg-amber-400": variant === "warning",
            "bg-red-400": variant === "destructive",
            "bg-muted-foreground": !variant || variant === "default" || variant === "muted" || variant === "outline",
          })}
        />
      )}
      {children}
    </span>
  );
}
