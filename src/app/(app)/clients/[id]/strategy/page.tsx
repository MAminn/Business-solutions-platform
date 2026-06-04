import { notFound } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import type { CampaignObjectiveType, StrategyStatus } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
import { Progress } from "@/components/ui/progress";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { AddObjectiveForm } from "@/components/clients/add-objective-form";
import { OBJECTIVE_LABEL, normalizeMetaObjective } from "@/lib/meta/objectives";
import {
  formatCurrency,
  formatCurrencyExact,
  formatMultiplier,
} from "@/lib/format";
import {
  createStrategy,
  archiveStrategy,
  removeObjective,
  updateStrategy,
} from "@/server/strategy";

interface PageProps {
  params: { id: string };
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

const STATUS_VARIANT: Record<StrategyStatus, "success" | "info" | "muted"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "muted",
};

export default async function StrategyPage({ params }: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      industry: true,
      monthlyBudget: true,
      minCpa: true,
      maxCpa: true,
      minRoas: true,
    },
  });
  if (!client) notFound();

  const strategy = await db.strategy.findFirst({
    where: { clientId: client.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      objectives: { orderBy: { createdAt: "asc" } },
    },
  });

  const header = (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{client.name}</h1>
        {client.industry && (
          <p className='mt-1 text-sm text-muted-foreground'>
            {client.industry}
          </p>
        )}
      </div>
      <ClientSubNav clientId={client.id} active='strategy' />
    </div>
  );

  // --- Empty state -----------------------------------------------------
  if (!strategy) {
    const now = new Date();
    const defaultPeriodStart = startOfMonth(now);
    const defaultPeriodEnd = endOfMonth(now);

    async function startStrategy() {
      "use server";
      await createStrategy({
        clientId: client!.id,
        name: "Current month",
        periodStart: defaultPeriodStart,
        periodEnd: defaultPeriodEnd,
        monthlyBudget: num(client!.monthlyBudget) || undefined,
        minCpa: client!.minCpa ? num(client!.minCpa) : undefined,
        maxCpa: client!.maxCpa ? num(client!.maxCpa) : undefined,
        minRoas: client!.minRoas ? num(client!.minRoas) : undefined,
      });
    }

    return (
      <div className='space-y-8'>
        {header}
        <Card>
          <CardHeader>
            <CardTitle>No strategy yet</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              Define a budget plan and per-objective allocations for this
              client. We&apos;ll pre-fill defaults from the client profile.
            </p>
            <form action={startStrategy}>
              <Button type='submit' size='sm'>
                Start strategy
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Populated state -------------------------------------------------
  const campaigns = await db.campaign.findMany({
    where: { adAccountConnection: { clientId: client.id } },
    select: { id: true, objective: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const insightsByCampaign =
    campaignIds.length > 0
      ? await db.insightsDaily.groupBy({
          by: ["entityId"],
          where: {
            entityType: "CAMPAIGN",
            entityId: { in: campaignIds },
            date: { gte: strategy.periodStart, lte: strategy.periodEnd },
          },
          _sum: {
            spend: true,
            conversionValue: true,
            conversions: true,
          },
        })
      : [];

  // Spend / revenue / conversions aggregated by normalized objective.
  const byObjective = new Map<
    CampaignObjectiveType,
    { spend: number; revenue: number; conversions: number }
  >();
  for (const row of insightsByCampaign) {
    const camp = campaigns.find((c) => c.id === row.entityId);
    if (!camp) continue;
    const objKey = normalizeMetaObjective(camp.objective);
    const cur = byObjective.get(objKey) ?? {
      spend: 0,
      revenue: 0,
      conversions: 0,
    };
    cur.spend += num(row._sum.spend);
    cur.revenue += num(row._sum.conversionValue);
    cur.conversions += num(row._sum.conversions);
    byObjective.set(objKey, cur);
  }

  const totalSpend = Array.from(byObjective.values()).reduce(
    (a, b) => a + b.spend,
    0,
  );
  const totalRevenue = Array.from(byObjective.values()).reduce(
    (a, b) => a + b.revenue,
    0,
  );
  const totalConversions = Array.from(byObjective.values()).reduce(
    (a, b) => a + b.conversions,
    0,
  );

  const monthlyBudget = num(strategy.monthlyBudget);
  const revenueGoal = num(strategy.revenueGoal);
  const remainingBudget = monthlyBudget - totalSpend;
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const overallCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

  const minCpa = strategy.minCpa ? num(strategy.minCpa) : 0;
  const maxCpa = strategy.maxCpa ? num(strategy.maxCpa) : 0;
  const minRoas = strategy.minRoas ? num(strategy.minRoas) : 0;

  const cpaInBand =
    totalConversions === 0
      ? null
      : (minCpa === 0 || overallCpa >= minCpa) &&
        (maxCpa === 0 || overallCpa <= maxCpa);
  const roasMet =
    totalSpend === 0 ? null : minRoas === 0 ? true : overallRoas >= minRoas;
  const revenueMet = revenueGoal === 0 ? null : totalRevenue >= revenueGoal;

  // Tracked objective ids for already-budgeted types.
  const budgetedTypes = new Set(strategy.objectives.map((o) => o.type));
  const unbudgetedTypes = (
    Object.keys(OBJECTIVE_LABEL) as CampaignObjectiveType[]
  ).filter(
    (t) => !budgetedTypes.has(t) && (byObjective.get(t)?.spend ?? 0) > 0,
  );

  const availableTypes = (
    Object.keys(OBJECTIVE_LABEL) as CampaignObjectiveType[]
  ).filter((t) => !budgetedTypes.has(t));

  // ---- Server actions (inline so they capture strategy.id) -----------
  async function archiveAction() {
    "use server";
    await archiveStrategy({ id: strategy!.id });
  }

  async function updateStrategyAction(formData: FormData) {
    "use server";
    const get = (k: string): string | undefined => {
      const v = String(formData.get(k) ?? "").trim();
      return v.length === 0 ? undefined : v;
    };
    const toDate = (v: string | undefined): Date | undefined =>
      v ? new Date(v) : undefined;
    await updateStrategy({
      id: strategy!.id,
      name: get("name"),
      periodStart: toDate(get("periodStart")),
      periodEnd: toDate(get("periodEnd")),
      monthlyBudget: get("monthlyBudget"),
      revenueGoal: get("revenueGoal"),
      conversionGoal: get("conversionGoal"),
      minCpa: get("minCpa"),
      maxCpa: get("maxCpa"),
      minRoas: get("minRoas"),
      notes: get("notes"),
    });
  }

  async function removeObjectiveAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (id) await removeObjective({ id });
  }

  const periodLabel = `${format(strategy.periodStart, "MMM d")} – ${format(strategy.periodEnd, "MMM d, yyyy")}`;

  return (
    <div className='space-y-8'>
      {header}

      {/* Strategy header card */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold tracking-tight'>Strategy</h2>
          <p className='text-sm text-muted-foreground'>
            {strategy.name ?? "Untitled"} · {periodLabel}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Badge variant={STATUS_VARIANT[strategy.status]} withDot>
            {strategy.status.toLowerCase()}
          </Badge>
        </div>
      </div>

      {/* Overall progress */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Overall progress</CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-2 gap-4 md:grid-cols-6'>
            <Stat
              label='Total budget'
              value={monthlyBudget > 0 ? formatCurrency(monthlyBudget) : "—"}
            />
            <Stat label='Spent' value={formatCurrency(totalSpend)} />
            <Stat
              label='Remaining'
              value={monthlyBudget > 0 ? formatCurrency(remainingBudget) : "—"}
            />
            <Stat label='Revenue' value={formatCurrency(totalRevenue)} />
            <Stat
              label='Revenue goal'
              value={revenueGoal > 0 ? formatCurrency(revenueGoal) : "—"}
            />
            <Stat label='ROAS' value={formatMultiplier(overallRoas)} />
          </div>

          {monthlyBudget > 0 && (
            <Progress
              value={Math.min(100, (totalSpend / monthlyBudget) * 100)}
            />
          )}

          <div className='flex flex-wrap items-center gap-2'>
            {cpaInBand !== null && (
              <Badge variant={cpaInBand ? "success" : "warning"} withDot>
                CPA {cpaInBand ? "in range" : "out of range"}
              </Badge>
            )}
            {roasMet !== null && (
              <Badge variant={roasMet ? "success" : "warning"} withDot>
                ROAS {roasMet ? "on target" : "below target"}
              </Badge>
            )}
            {revenueMet !== null && (
              <Badge variant={revenueMet ? "success" : "warning"} withDot>
                Revenue {revenueMet ? "goal met" : "below goal"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Objectives */}
      <div className='space-y-3'>
        <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
          Objectives
        </h3>

        {strategy.objectives.length === 0 ? (
          <Card>
            <CardContent className='py-6 text-sm text-muted-foreground'>
              No objectives yet. Add one below.
            </CardContent>
          </Card>
        ) : (
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3'>
            {strategy.objectives.map((obj) => {
              const allocated = num(obj.allocatedBudget);
              const actual = byObjective.get(obj.type) ?? {
                spend: 0,
                revenue: 0,
                conversions: 0,
              };
              const remaining = allocated - actual.spend;
              const roas = actual.spend > 0 ? actual.revenue / actual.spend : 0;
              const cpa =
                actual.conversions > 0 ? actual.spend / actual.conversions : 0;
              const pct =
                allocated > 0
                  ? Math.min(100, (actual.spend / allocated) * 100)
                  : 0;

              return (
                <Card key={obj.id}>
                  <CardHeader className='pb-3'>
                    <CardTitle className='text-base'>
                      {OBJECTIVE_LABEL[obj.type]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <div className='grid grid-cols-2 gap-2 text-xs'>
                      <Stat
                        label='Allocated'
                        value={formatCurrency(allocated)}
                      />
                      <Stat
                        label='Spent'
                        value={formatCurrency(actual.spend)}
                      />
                      <Stat
                        label='Remaining'
                        value={formatCurrency(remaining)}
                      />
                      <Stat
                        label='Revenue'
                        value={formatCurrency(actual.revenue)}
                      />
                      <Stat label='ROAS' value={formatMultiplier(roas)} />
                      <Stat
                        label='CPA'
                        value={cpa > 0 ? formatCurrencyExact(cpa) : "—"}
                      />
                    </div>
                    <Progress value={pct} />
                    <form
                      action={removeObjectiveAction}
                      className='flex justify-end'>
                      <input type='hidden' name='id' value={obj.id} />
                      <Button
                        type='submit'
                        variant='ghost'
                        size='sm'
                        className='text-destructive'>
                        Remove
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {unbudgetedTypes.length > 0 && (
          <Card className='border-dashed'>
            <CardContent className='py-4 text-xs text-muted-foreground'>
              {unbudgetedTypes.map((t) => (
                <p key={t}>
                  Unbudgeted: {OBJECTIVE_LABEL[t]} ·{" "}
                  {formatCurrency(byObjective.get(t)?.spend ?? 0)} spent
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add objective */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Add objective</CardTitle>
        </CardHeader>
        <CardContent>
          <AddObjectiveForm
            strategyId={strategy.id}
            availableTypes={availableTypes}
          />
        </CardContent>
      </Card>

      {/* Edit strategy */}
      <details className='rounded-lg border border-border/60 bg-card'>
        <summary className='cursor-pointer px-4 py-3 text-sm font-medium'>
          Edit strategy
        </summary>
        <div className='space-y-4 border-t border-border/60 p-4'>
          <form action={updateStrategyAction} className='space-y-3'>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <LabeledField
                label='Name'
                name='name'
                defaultValue={strategy.name ?? ""}
              />
              <LabeledField
                label='Monthly budget'
                name='monthlyBudget'
                type='number'
                step='0.01'
                defaultValue={monthlyBudget > 0 ? String(monthlyBudget) : ""}
              />
              <LabeledField
                label='Period start'
                name='periodStart'
                type='date'
                defaultValue={format(strategy.periodStart, "yyyy-MM-dd")}
              />
              <LabeledField
                label='Period end'
                name='periodEnd'
                type='date'
                defaultValue={format(strategy.periodEnd, "yyyy-MM-dd")}
              />
              <LabeledField
                label='Revenue goal'
                name='revenueGoal'
                type='number'
                step='0.01'
                defaultValue={revenueGoal > 0 ? String(revenueGoal) : ""}
              />
              <LabeledField
                label='Conversion goal'
                name='conversionGoal'
                type='number'
                step='1'
                defaultValue={
                  strategy.conversionGoal ? String(strategy.conversionGoal) : ""
                }
              />
              <LabeledField
                label='Min CPA'
                name='minCpa'
                type='number'
                step='0.01'
                defaultValue={minCpa > 0 ? String(minCpa) : ""}
              />
              <LabeledField
                label='Max CPA'
                name='maxCpa'
                type='number'
                step='0.01'
                defaultValue={maxCpa > 0 ? String(maxCpa) : ""}
              />
              <LabeledField
                label='Min ROAS'
                name='minRoas'
                type='number'
                step='0.01'
                defaultValue={minRoas > 0 ? String(minRoas) : ""}
              />
            </div>
            <LabeledField
              label='Notes'
              name='notes'
              defaultValue={strategy.notes ?? ""}
            />
            <Button type='submit' size='sm'>
              Save changes
            </Button>
          </form>

          <form action={archiveAction}>
            <Button type='submit' variant='outline' size='sm'>
              Archive strategy
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      <p className='mt-1 text-sm font-semibold text-foreground'>{value}</p>
    </div>
  );
}

function LabeledField({
  label,
  name,
  type = "text",
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string;
}) {
  return (
    <div className='space-y-1.5'>
      <label
        htmlFor={`strat-${name}`}
        className='text-xs font-medium text-muted-foreground'>
        {label}
      </label>
      <input
        id={`strat-${name}`}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className='flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring'
      />
    </div>
  );
}
