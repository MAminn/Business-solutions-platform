import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";
import { formatMultiplier, formatCurrencyCompact } from "@/lib/format";
import { paceState, type PaceState } from "@/lib/dashboard-flags";
import type { ClientHealth } from "@prisma/client";

interface ActiveClient {
  id: string;
  name: string;
  industry: string | null;
  health: ClientHealth;
  pacing: number; // 0..100
  roas: number;
  isStale: boolean;
  mtdSpend: number;
  monthlyBudget: number;
  currency: string | null;
  funding?: { amount: number; currency: string };
}

const healthBadge: Record<
  ClientHealth,
  { variant: "success" | "info" | "warning" | "destructive"; label: string }
> = {
  EXCELLENT: { variant: "success", label: "Excellent" },
  GOOD: { variant: "info", label: "Good" },
  NEEDS_ATTENTION: { variant: "warning", label: "Needs Attention" },
  AT_RISK: { variant: "destructive", label: "At Risk" },
};

const paceStyle: Record<
  PaceState,
  { indicator: string; text: string; label: string }
> = {
  over: { indicator: "bg-warning", text: "text-warning", label: "Over pace" },
  under: { indicator: "bg-info", text: "text-info", label: "Under pace" },
  stalled: {
    indicator: "bg-muted-foreground",
    text: "text-muted-foreground",
    label: "Stalled",
  },
  healthy: {
    indicator: "bg-success",
    text: "text-success",
    label: "On pace",
  },
  stale: {
    indicator: "bg-muted-foreground",
    text: "text-muted-foreground",
    label: "Data not fresh",
  },
};

export function ActiveClients({ clients }: { clients: ActiveClient[] }) {
  return (
    <Card className='p-5'>
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h3 className='text-base font-semibold'>Active clients</h3>
          <p className='text-xs text-muted-foreground'>
            Health, pacing, and ROAS at a glance
          </p>
        </div>
        <Link
          href='/clients'
          className='inline-flex items-center gap-1 text-xs text-primary hover:underline'>
          Open Client Hub <ArrowRight className='h-3 w-3' />
        </Link>
      </div>
      <ul className='divide-y divide-border/40'>
        {clients.map((c) => {
          const badge = healthBadge[c.health];
          const pace = paceState(c.pacing, c.isStale);
          const style = paceStyle[pace];
          return (
            <li
              key={c.id}
              className='grid grid-cols-12 items-center gap-4 py-4'>
              <div className='col-span-4 flex items-center gap-3'>
                <Avatar name={c.name} gradientSeed={c.id} />
                <div className='min-w-0'>
                  <Link
                    href={`/clients/${c.id}`}
                    className='block truncate text-sm font-medium hover:underline'>
                    {c.name}
                  </Link>
                  <p className='truncate text-xs text-muted-foreground'>
                    {c.industry ?? "—"}
                  </p>
                  <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground'>
                    <span>
                      Spend{" "}
                      <span className='font-medium tabular-nums text-foreground'>
                        {formatCurrencyCompact(c.mtdSpend, c.currency ?? "")}
                      </span>
                    </span>
                    <span className='text-border'>·</span>
                    <span>
                      Budget{" "}
                      <span className='font-medium tabular-nums text-foreground'>
                        {formatCurrencyCompact(
                          c.monthlyBudget,
                          c.currency ?? "",
                        )}
                      </span>
                    </span>
                    {c.funding && (
                      <>
                        <span className='text-border'>·</span>
                        <span>
                          Funding{" "}
                          <span className='font-medium tabular-nums text-foreground'>
                            {formatCurrencyCompact(
                              c.funding.amount,
                              c.funding.currency,
                            )}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className='col-span-5'>
                <div className='mb-1.5 flex items-baseline justify-between text-xs'>
                  <span className={style.text}>{style.label}</span>
                  <span className='font-medium tabular-nums'>{c.pacing}%</span>
                </div>
                <Progress
                  value={c.pacing}
                  indicatorClassName={style.indicator}
                />
              </div>
              <div className='col-span-1 text-sm font-semibold tabular-nums'>
                {formatMultiplier(c.roas)}
                <span className='ml-1 text-[10px] font-normal uppercase text-muted-foreground'>
                  ROAS
                </span>
              </div>
              <div className='col-span-2 flex justify-end'>
                <Badge variant={badge.variant} withDot>
                  {badge.label}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
