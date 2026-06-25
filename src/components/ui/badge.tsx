import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-secondary text-secondary-foreground border border-border/60",
        outline: "border border-border text-foreground",
        success: "bg-success/15 text-success border border-success/20",
        info: "bg-info/15 text-info border border-info/20",
        warning: "bg-warning/15 text-warning border border-warning/20",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/20",
        muted: "bg-muted text-muted-foreground border border-border/60",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  withDot?: boolean;
}

export function Badge({
  className,
  variant,
  withDot,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {withDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-success": variant === "success",
            "bg-info": variant === "info",
            "bg-warning": variant === "warning",
            "bg-destructive": variant === "destructive",
            "bg-muted-foreground":
              !variant ||
              variant === "default" ||
              variant === "muted" ||
              variant === "outline",
          })}
        />
      )}
      {children}
    </span>
  );
}
