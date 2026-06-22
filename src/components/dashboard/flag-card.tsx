import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Flag, FlagSeverity } from "@/lib/dashboard-flags";

const severityDot: Record<FlagSeverity, string> = {
  CRITICAL: "bg-destructive",
  WARNING: "bg-warning",
  STALE: "bg-muted-foreground",
};

export function FlagCard({ flag }: { flag: Flag }) {
  return (
    <Link
      href={`/clients/${flag.clientId}`}
      className='group block focus:outline-none'>
      <Card className='h-full p-4 transition-colors group-hover:border-border group-focus-visible:border-border'>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              severityDot[flag.severity],
            )}
          />
          <span className='truncate text-sm font-medium'>
            {flag.clientName}
          </span>
        </div>
        <p className='mt-2 text-sm font-semibold tracking-tight'>
          {flag.label}
        </p>
        <p className='mt-0.5 truncate text-xs text-muted-foreground'>
          {flag.detail}
        </p>
      </Card>
    </Link>
  );
}
