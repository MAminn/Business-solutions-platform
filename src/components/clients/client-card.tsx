"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { ClientHealth, ClientStatus } from "@prisma/client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { EditClientDialog } from "@/components/clients/edit-client-dialog";
import { formatCurrencyCompact, formatMultiplier } from "@/lib/format";

type HealthVariant = "success" | "info" | "warning" | "destructive";

const HEALTH_VARIANT: Record<ClientHealth, HealthVariant> = {
  EXCELLENT: "success",
  GOOD: "info",
  NEEDS_ATTENTION: "warning",
  AT_RISK: "destructive",
};

const HEALTH_LABEL: Record<ClientHealth, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  NEEDS_ATTENTION: "Needs attention",
  AT_RISK: "At risk",
};

export interface ClientCardProps {
  client: {
    id: string;
    name: string;
    industry: string | null;
    logoUrl: string | null;
    health: ClientHealth;
    monthlyBudget: number;
    pacing: number;
    roas: number;
    // Edit-form prefill values (carried through updateClient).
    status: ClientStatus;
    minRoas: number | null;
    minCpa: number | null;
    maxCpa: number | null;
    notes: string | null;
  };
}

export function ClientCard({ client }: ClientCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const pacing = Math.max(0, Math.min(100, Math.round(client.pacing)));

  return (
    <div className='relative'>
      <Link
        href={`/clients/${client.id}`}
        className='block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring'>
        <Card className='flex h-full flex-col gap-5 p-5 transition-colors hover:border-border hover:bg-card/80'>
          {/* Top row */}
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <Avatar
                name={client.name}
                gradientSeed={client.id}
                src={client.logoUrl ?? undefined}
              />
              <div className='min-w-0'>
                <p className='truncate text-sm font-semibold text-foreground'>
                  {client.name}
                </p>
                {client.industry && (
                  <p className='truncate text-xs text-muted-foreground'>
                    {client.industry}
                  </p>
                )}
              </div>
            </div>
            {/* Spacer reserves room for the absolutely-positioned menu button. */}
            <span className='h-8 w-8 shrink-0' aria-hidden='true' />
          </div>

          {/* Health + platform pills */}
          <div className='flex items-center justify-between gap-2'>
            <Badge variant={HEALTH_VARIANT[client.health]} withDot>
              {HEALTH_LABEL[client.health]}
            </Badge>
            <Badge variant='outline'>Meta</Badge>
          </div>

          {/* Stats row */}
          <div className='flex items-end justify-between gap-4'>
            <div className='space-y-1'>
              <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                Budget
              </p>
              <p className='text-lg font-semibold text-foreground'>
                {formatCurrencyCompact(client.monthlyBudget)}
              </p>
            </div>
            <div className='space-y-1 text-right'>
              <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                ROAS
              </p>
              <p className='text-lg font-semibold text-foreground'>
                {formatMultiplier(client.roas)}
              </p>
            </div>
          </div>

          {/* Pacing */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between text-xs'>
              <span className='text-muted-foreground'>Pacing</span>
              <span className='font-medium text-foreground'>{pacing}%</span>
            </div>
            <Progress value={pacing} />
          </div>
        </Card>
      </Link>

      {/* Menu lives outside the <Link> so opening it never navigates. */}
      <div className='absolute right-3 top-3 z-10'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='Client actions'
              className='inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring'>
              <MoreHorizontal className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              Edit client
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => router.push(`/clients/${client.id}`)}>
              Open client
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditClientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={{
          id: client.id,
          name: client.name,
          industry: client.industry,
          logoUrl: client.logoUrl,
          monthlyBudget: client.monthlyBudget > 0 ? client.monthlyBudget : null,
          minRoas: client.minRoas,
          minCpa: client.minCpa,
          maxCpa: client.maxCpa,
          notes: client.notes,
          status: client.status,
          health: client.health,
        }}
      />
    </div>
  );
}
