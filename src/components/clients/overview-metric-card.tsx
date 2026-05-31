import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OverviewMetricCardProps {
  label: string;
  value: string;
  sub?: string;
  target?: string;
  delta?: { value: string; positive: boolean } | null;
  warning?: boolean;
}

export function OverviewMetricCard({
  label,
  value,
  sub,
  target,
  delta,
  warning = false,
}: OverviewMetricCardProps) {
  return (
    <Card
      className={cn(
        "p-4",
        warning && "border-amber-500/40 bg-amber-500/[0.03]",
      )}>
      <div className='flex items-start justify-between gap-2'>
        <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
          {label}
        </p>
        {warning && (
          <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400' />
        )}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          warning ? "text-amber-300" : "text-foreground",
        )}>
        {value}
      </p>
      <div className='mt-2 flex items-center gap-2 text-[11px]'>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-medium",
              delta.positive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400",
            )}>
            {delta.positive ? (
              <ArrowUpRight className='h-3 w-3' />
            ) : (
              <ArrowDownRight className='h-3 w-3' />
            )}
            {delta.value}
          </span>
        )}
        {sub && <span className='text-muted-foreground'>{sub}</span>}
      </div>
      {target && (
        <p className='mt-1 text-[10px] text-muted-foreground'>{target}</p>
      )}
    </Card>
  );
}
