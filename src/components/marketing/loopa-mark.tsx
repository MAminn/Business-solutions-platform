import { cn } from "@/lib/utils";

/**
 * The Loopa "LP" mark, matching the badge used in the internal app sidebar.
 * Public marketing surface only.
 */
export function LoopaMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent",
        className,
      )}>
      <span className='text-sm font-bold tracking-tight text-accent-foreground'>
        LP
      </span>
    </span>
  );
}
