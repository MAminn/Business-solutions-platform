import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: { value: string; label: string; positive: boolean };
  icon: LucideIcon;
}

export function KpiCard({ label, value, delta, icon: Icon }: KpiCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      {delta && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
              delta.positive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            )}
          >
            {delta.positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.value}
          </span>
          <span className="text-muted-foreground">{delta.label}</span>
        </div>
      )}
    </Card>
  );
}
