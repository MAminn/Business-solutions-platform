import * as React from "react";
import { cn, initials, pickGradient } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  gradientSeed?: string;
}

export function Avatar({ name, src, size = "md", className, gradientSeed, ...props }: AvatarProps) {
  const sizes = {
    sm: "h-8 w-8 text-[10px]",
    md: "h-10 w-10 text-xs",
    lg: "h-12 w-12 text-sm",
  };
  const gradient = pickGradient(gradientSeed ?? name);
  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
        `bg-gradient-to-br ${gradient}`,
        sizes[size],
        className
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full rounded-lg object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
