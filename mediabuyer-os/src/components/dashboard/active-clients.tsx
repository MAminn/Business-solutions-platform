import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";
import { formatMultiplier } from "@/lib/format";
import type { ClientHealth } from "@prisma/client";

interface ActiveClient {
  id: string;
  name: string;
  industry: string | null;
  health: ClientHealth;
  pacing: number; // 0..100
  roas: number;
}

const healthBadge: Record<ClientHealth, { variant: "success" | "info" | "warning" | "destructive"; label: string }> = {
  EXCELLENT: { variant: "success", label: "Excellent" },
  GOOD: { variant: "info", label: "Good" },
  NEEDS_ATTENTION: { variant: "warning", label: "Needs Attention" },
  AT_RISK: { variant: "destructive", label: "At Risk" },
};

export function ActiveClients({ clients }: { clients: ActiveClient[] }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Active clients</h3>
          <p className="text-xs text-muted-foreground">Health, pacing, and ROAS at a glance</p>
        </div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open Client Hub <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {clients.map((c) => {
          const badge = healthBadge[c.health];
          return (
            <li key={c.id} className="grid grid-cols-12 items-center gap-4 py-4">
              <div className="col-span-4 flex items-center gap-3">
                <Avatar name={c.name} gradientSeed={c.id} />
                <div className="min-w-0">
                  <Link href={`/clients/${c.id}`} className="block truncate text-sm font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{c.industry ?? "—"}</p>
                </div>
              </div>
              <div className="col-span-5">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">Pacing</span>
                  <span className="font-medium">{c.pacing}%</span>
                </div>
                <Progress value={c.pacing} />
              </div>
              <div className="col-span-1 text-sm font-semibold">
                {formatMultiplier(c.roas)}
                <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">ROAS</span>
              </div>
              <div className="col-span-2 flex justify-end">
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
