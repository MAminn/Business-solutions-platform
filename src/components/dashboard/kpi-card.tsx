import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: { value: string; label: string; positive: boolean };
  icon: LucideIcon;
  caption?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  caption,
}: KpiCardProps) {
  return (
    <Card className='p-5'>
      <div className='flex items-start justify-between'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
          {label}
        </p>
        <div className='flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-secondary/40'>
          <Icon className='h-4 w-4 text-muted-foreground' />
        </div>
      </div>
      <p className='mt-4 text-3xl font-semibold tabular-nums tracking-tight'>
        {value}
      </p>
      {caption && (
        <p className='mt-1 text-[10px] text-muted-foreground'>{caption}</p>
      )}
      {delta && (
        <div className='mt-3 flex items-center gap-2 text-xs'>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums",
              delta.positive
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}>
            {delta.positive ? (
              <ArrowUpRight className='h-3 w-3' />
            ) : (
              <ArrowDownRight className='h-3 w-3' />
            )}
            {delta.value}
          </span>
          <span className='text-muted-foreground'>{delta.label}</span>
        </div>
      )}
    </Card>
  );
}
