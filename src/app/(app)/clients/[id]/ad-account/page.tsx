import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import type { ConnectionStatus } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { GenerateDigestButton } from "@/components/integrations/generate-digest-button";
import { FundingCycleForm } from "@/components/funding/funding-cycle-form";
import { FundingCancelButton } from "@/components/funding/funding-cancel-button";
import { listFundingCycles, type FundingCycleListItem } from "@/server/funding";
import { formatCurrencyExact } from "@/lib/format";
import { previousCompletedMonth } from "@/lib/month";

interface PageProps {
  params: { id: string };
}

type DisplayStatus =
  | "Connected"
  | "Not authorized"
  | "Token expired"
  | "Revoked"
  | "Error";

const STATUS_VARIANT: Record<
  DisplayStatus,
  "success" | "warning" | "destructive" | "muted"
> = {
  Connected: "success",
  "Not authorized": "muted",
  "Token expired": "warning",
  Revoked: "destructive",
  Error: "destructive",
};

function resolveStatus(args: {
  accessTokenEnc: string | null;
  status: ConnectionStatus;
}): DisplayStatus {
  if (!args.accessTokenEnc) return "Not authorized";
  switch (args.status) {
    case "ACTIVE":
      return "Connected";
    case "EXPIRED":
      return "Token expired";
    case "REVOKED":
      return "Revoked";
    case "ERROR":
      return "Error";
    default:
      return "Error";
  }
}

export default async function AdAccountPage({ params }: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, industry: true },
  });
  if (!client) notFound();

  const connections = await db.adAccountConnection.findMany({
    where: { clientId: client.id },
    select: {
      id: true,
      platform: true,
      platformAccountId: true,
      accountName: true,
      currency: true,
      timezone: true,
      status: true,
      lastSyncedAt: true,
      accessTokenEnc: true,
      createdAt: true,
      _count: { select: { campaigns: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const fundingByConnection = new Map<string, FundingCycleListItem[]>();
  await Promise.all(
    connections.map(async (conn) => {
      fundingByConnection.set(conn.id, await listFundingCycles(conn.id));
    }),
  );

  const prevMonth = previousCompletedMonth();

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
      <ClientSubNav clientId={client.id} active='ad-account' />
    </div>
  );

  return (
    <div className='space-y-8'>
      {header}

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold tracking-tight'>Ad account</h2>
          <p className='text-sm text-muted-foreground'>
            Linked ad platform accounts for this client.
          </p>
        </div>
        <Button asChild size='sm' variant='outline'>
          <Link href='/settings/integrations'>Manage integrations</Link>
        </Button>
      </div>

      {connections.length === 0 ? (
        <EmptyState
          title='No ad account linked yet'
          description='Connect this client to a Meta ad account from Settings → Integrations to start pulling performance data.'
          action={
            <Button asChild size='sm'>
              <Link href='/settings/integrations'>Go to integrations</Link>
            </Button>
          }
        />
      ) : (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          {connections.map((conn) => {
            const status = resolveStatus({
              accessTokenEnc: conn.accessTokenEnc,
              status: conn.status,
            });
            return (
              <Card key={conn.id}>
                <CardHeader className='pb-3'>
                  <div className='flex items-start justify-between gap-3'>
                    <CardTitle className='text-base'>
                      {conn.accountName}
                    </CardTitle>
                    <Badge variant='info' withDot>
                      {conn.platform === "META" ? "Meta" : conn.platform}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <p className='font-mono text-xs text-muted-foreground'>
                    {conn.platformAccountId} · {conn.currency} · {conn.timezone}
                  </p>

                  <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
                    <Badge variant={STATUS_VARIANT[status]} withDot>
                      {status}
                    </Badge>
                    <span>
                      Last synced:{" "}
                      {conn.lastSyncedAt
                        ? formatDistanceToNow(conn.lastSyncedAt, {
                            addSuffix: true,
                          })
                        : "never"}
                    </span>
                    <span>{conn._count.campaigns} campaigns</span>
                  </div>

                  <div className='pt-1'>
                    <Button asChild size='sm' variant='outline'>
                      <Link href='/settings/integrations'>
                        Manage in integrations
                      </Link>
                    </Button>
                  </div>

                  <div className='flex flex-wrap items-center gap-2 border-t border-border/60 pt-3'>
                    <GenerateDigestButton connectionId={conn.id} />
                    <GenerateDigestButton
                      connectionId={conn.id}
                      mode='monthly'
                    />
                    <Button asChild size='sm' variant='outline'>
                      <a
                        href={`/api/connections/${conn.id}/creative-bundle`}
                        download>
                        Download creative bundle
                      </a>
                    </Button>
                    <Button asChild size='sm' variant='outline'>
                      <a
                        href={`/api/connections/${conn.id}/creative-report`}
                        download>
                        Export PDF Report
                      </a>
                    </Button>
                    <Button asChild size='sm' variant='outline'>
                      <a
                        href={`/api/connections/${conn.id}/creative-bundle?year=${prevMonth.year}&month=${prevMonth.month}`}
                        download>
                        Creative bundle (previous month)
                      </a>
                    </Button>
                  </div>

                  {(() => {
                    const cycles = fundingByConnection.get(conn.id) ?? [];
                    const active = cycles.find((c) => c.isActive);
                    const others = cycles.filter((c) => c.id !== active?.id);
                    return (
                      <div className='space-y-3 border-t border-border/60 pt-3'>
                        <h3 className='text-sm font-medium'>Funding</h3>
                        {cycles.length === 0 ? (
                          <p className='text-xs text-muted-foreground'>
                            No funding cycle logged yet.
                          </p>
                        ) : (
                          <div className='space-y-3'>
                            {active ? (
                              <div className='space-y-1'>
                                <p className='text-xs text-muted-foreground'>
                                  Current cycle
                                </p>
                                <p className='text-sm font-semibold'>
                                  {formatCurrencyExact(
                                    active.amount,
                                    active.currency,
                                  )}
                                </p>
                                <p className='text-xs text-muted-foreground'>
                                  Started{" "}
                                  {formatDistanceToNow(active.startedAt, {
                                    addSuffix: true,
                                  })}
                                  {active.note ? ` · ${active.note}` : ""}
                                </p>
                                <div className='pt-1'>
                                  <FundingCancelButton
                                    fundingCycleId={active.id}
                                  />
                                </div>
                              </div>
                            ) : (
                              <p className='text-xs text-muted-foreground'>
                                No active funding cycle.
                              </p>
                            )}
                            {others.length > 0 && (
                              <div className='space-y-1'>
                                <p className='text-xs text-muted-foreground'>
                                  History
                                </p>
                                <ul className='space-y-1.5'>
                                  {others.map((cycle) => {
                                    const isCancelled =
                                      cycle.cancelledAt !== null;
                                    return (
                                      <li
                                        key={cycle.id}
                                        className={`flex items-center justify-between gap-3 text-xs ${isCancelled ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                                        <span className='flex items-center gap-2'>
                                          <span>
                                            {formatCurrencyExact(
                                              cycle.amount,
                                              cycle.currency,
                                            )}
                                          </span>
                                          {isCancelled && (
                                            <Badge variant='muted'>
                                              Cancelled
                                            </Badge>
                                          )}
                                        </span>
                                        <span className='flex items-center gap-3'>
                                          <span>
                                            {format(
                                              cycle.startedAt,
                                              "MMM d, yyyy",
                                            )}
                                          </span>
                                          {!isCancelled && (
                                            <FundingCancelButton
                                              fundingCycleId={cycle.id}
                                            />
                                          )}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        <FundingCycleForm
                          adAccountConnectionId={conn.id}
                          currency={conn.currency}
                        />
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
