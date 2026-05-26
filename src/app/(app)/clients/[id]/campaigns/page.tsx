import Link from "next/link";
import { notFound } from "next/navigation";
import { subDays } from "date-fns";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import {
  formatCurrencyExact,
  formatMultiplier,
  formatPercent,
} from "@/lib/format";

export const dynamic = "force-dynamic";

type StatusFilter = "ACTIVE" | "PAUSED" | "DRAFT" | "ALL";
type SortField = "spend" | "roas" | "cpa" | "ctr" | "name";
type SortOrder = "asc" | "desc";

interface PageProps {
  params: { id: string };
  searchParams: {
    status?: string;
    sort?: string;
    order?: string;
  };
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function parseStatus(raw: string | undefined): StatusFilter {
  if (raw === "ACTIVE" || raw === "PAUSED" || raw === "DRAFT") return raw;
  return "ALL";
}

function parseSort(raw: string | undefined): SortField {
  if (raw === "roas" || raw === "cpa" || raw === "ctr" || raw === "name")
    return raw;
  return "spend";
}

function parseOrder(raw: string | undefined): SortOrder {
  return raw === "asc" ? "asc" : "desc";
}

interface CampaignRow {
  id: string;
  name: string;
  accountName: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  spend: number;
  roas: number;
  cpa: number;
  ctr: number;
  hookRate: number;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "DRAFT", label: "Draft" },
];

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toUpperCase();
  if (s === "ACTIVE") {
    return (
      <Badge variant='success' withDot>
        Active
      </Badge>
    );
  }
  if (s === "PAUSED") {
    return (
      <Badge variant='warning' withDot>
        Paused
      </Badge>
    );
  }
  if (s === "DRAFT") {
    return (
      <Badge variant='muted' withDot>
        Draft
      </Badge>
    );
  }
  return (
    <Badge variant='muted' withDot>
      {status ?? "—"}
    </Badge>
  );
}

interface SortableHeaderProps {
  field: SortField;
  label: string;
  sort: SortField;
  order: SortOrder;
  status: StatusFilter;
  clientId: string;
  align?: "left" | "right";
}

function SortableHeader({
  field,
  label,
  sort,
  order,
  status,
  clientId,
  align = "left",
}: SortableHeaderProps) {
  const nextOrder: SortOrder =
    sort === field && order === "desc" ? "asc" : "desc";
  const params = new URLSearchParams({
    status,
    sort: field,
    order: nextOrder,
  });
  const href = `/clients/${clientId}/campaigns?${params.toString()}`;
  const isActive = sort === field;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          align === "right" ? "justify-end" : ""
        }`}>
        {label}
        {isActive ? (
          order === "desc" ? (
            <ChevronDown className='h-3.5 w-3.5' />
          ) : (
            <ChevronUp className='h-3.5 w-3.5' />
          )
        ) : (
          <ChevronsUpDown className='h-3.5 w-3.5 opacity-40' />
        )}
      </Link>
    </TableHead>
  );
}

function compareRows(a: CampaignRow, b: CampaignRow, sort: SortField): number {
  if (sort === "name") {
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  }
  return a[sort] - b[sort];
}

export default async function ClientCampaignsPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, industry: true },
  });
  if (!client) notFound();

  const statusFilter = parseStatus(searchParams.status);
  const sort = parseSort(searchParams.sort);
  const order = parseOrder(searchParams.order);

  const campaigns = await db.campaign.findMany({
    where: {
      adAccountConnection: { clientId: client.id },
      ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      objective: true,
      status: true,
      effectiveStatus: true,
      dailyBudget: true,
      updatedAt: true,
      adAccountConnection: {
        select: { id: true, accountName: true, currency: true },
      },
    },
  });

  const since = subDays(new Date(), 30);
  const campaignIds = campaigns.map((c) => c.id);

  const [insights, hookRows] = await Promise.all([
    campaignIds.length > 0
      ? db.insightsDaily.groupBy({
          by: ["entityId"],
          where: {
            entityType: "CAMPAIGN",
            entityId: { in: campaignIds },
            date: { gte: since },
          },
          _sum: {
            spend: true,
            conversionValue: true,
            conversions: true,
            clicks: true,
            impressions: true,
          },
        })
      : Promise.resolve(
          [] as Array<{
            entityId: string;
            _sum: {
              spend: unknown;
              conversionValue: unknown;
              conversions: unknown;
              clicks: unknown;
              impressions: unknown;
            };
          }>,
        ),
    campaignIds.length > 0
      ? db.insightsDaily.findMany({
          where: {
            entityType: "CAMPAIGN",
            entityId: { in: campaignIds },
            date: { gte: since },
          },
          select: {
            entityId: true,
            hookRate: true,
            impressions: true,
          },
        })
      : Promise.resolve(
          [] as Array<{
            entityId: string;
            hookRate: unknown;
            impressions: unknown;
          }>,
        ),
  ]);

  const insightsByCampaign = new Map<string, (typeof insights)[number]>();
  for (const row of insights) {
    insightsByCampaign.set(row.entityId, row);
  }

  // Impressions-weighted hookRate per campaign.
  const hookAccum = new Map<
    string,
    { weighted: number; impressions: number }
  >();
  for (const row of hookRows) {
    const hr = row.hookRate;
    if (hr === null || hr === undefined) continue;
    const imp = num(row.impressions);
    if (imp <= 0) continue;
    const cur = hookAccum.get(row.entityId) ?? {
      weighted: 0,
      impressions: 0,
    };
    cur.weighted += num(hr) * imp;
    cur.impressions += imp;
    hookAccum.set(row.entityId, cur);
  }

  const rows: CampaignRow[] = campaigns.map((c) => {
    const agg = insightsByCampaign.get(c.id);
    const spend = num(agg?._sum.spend);
    const convValue = num(agg?._sum.conversionValue);
    const conversions = num(agg?._sum.conversions);
    const clicks = num(agg?._sum.clicks);
    const impressions = num(agg?._sum.impressions);
    const roas = spend > 0 ? convValue / spend : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const hook = hookAccum.get(c.id);
    const hookRate =
      hook && hook.impressions > 0 ? hook.weighted / hook.impressions : 0;
    return {
      id: c.id,
      name: c.name,
      accountName: c.adAccountConnection.accountName,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      objective: c.objective,
      spend,
      roas,
      cpa,
      ctr,
      hookRate,
    };
  });

  rows.sort((a, b) => {
    const primary = compareRows(a, b, sort);
    if (primary !== 0) return order === "desc" ? -primary : primary;
    // Tie-breaker: name asc, case-insensitive.
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return (
    <div className='space-y-8'>
      <div className='space-y-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {client.name}
          </h1>
          {client.industry && (
            <p className='mt-1 text-sm text-muted-foreground'>
              {client.industry}
            </p>
          )}
        </div>
        <ClientSubNav clientId={client.id} active='campaigns' />
      </div>

      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <h2 className='text-lg font-semibold tracking-tight'>Campaigns</h2>
          <Badge variant='muted'>Last 30 days</Badge>
        </div>
        <form
          action={`/clients/${client.id}/campaigns`}
          method='get'
          className='flex items-center gap-2'>
          <label
            htmlFor='campaign-status-filter'
            className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
            Status
          </label>
          <select
            id='campaign-status-filter'
            name='status'
            defaultValue={statusFilter}
            className='h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input type='hidden' name='sort' value={sort} />
          <input type='hidden' name='order' value={order} />
          <Button type='submit' size='sm' variant='outline'>
            Apply
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title='No campaigns yet'
          description="Connect this client's Meta ad account in Integrations to start syncing campaigns."
        />
      ) : (
        <div className='rounded-xl border border-border/60 bg-card'>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader
                  field='name'
                  label='Campaign'
                  sort={sort}
                  order={order}
                  status={statusFilter}
                  clientId={client.id}
                />
                <TableHead>Status</TableHead>
                <SortableHeader
                  field='spend'
                  label='Spend'
                  sort={sort}
                  order={order}
                  status={statusFilter}
                  clientId={client.id}
                />
                <SortableHeader
                  field='roas'
                  label='ROAS'
                  sort={sort}
                  order={order}
                  status={statusFilter}
                  clientId={client.id}
                />
                <SortableHeader
                  field='cpa'
                  label='CPA'
                  sort={sort}
                  order={order}
                  status={statusFilter}
                  clientId={client.id}
                />
                <SortableHeader
                  field='ctr'
                  label='CTR'
                  sort={sort}
                  order={order}
                  status={statusFilter}
                  clientId={client.id}
                />
                <TableHead>Hook rate</TableHead>
                <TableHead>Objective</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className='font-medium'>
                    {r.name}
                    <div className='text-xs text-muted-foreground'>
                      {r.accountName}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>{formatCurrencyExact(r.spend)}</TableCell>
                  <TableCell>{formatMultiplier(r.roas)}</TableCell>
                  <TableCell>
                    {r.cpa > 0 ? formatCurrencyExact(r.cpa) : "—"}
                  </TableCell>
                  <TableCell>
                    {r.ctr > 0 ? formatPercent(r.ctr) : "—"}
                  </TableCell>
                  <TableCell>
                    {r.hookRate > 0 ? formatPercent(r.hookRate) : "—"}
                  </TableCell>
                  <TableCell>
                    <span className='font-mono text-xs text-muted-foreground'>
                      {r.objective ?? "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
