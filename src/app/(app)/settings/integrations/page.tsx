import { formatDistanceToNow } from "date-fns";
import type { ConnectionStatus } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConnectMetaButton } from "@/components/integrations/connect-meta-button";
import { DisconnectButton } from "@/components/integrations/disconnect-button";
import { SyncNowButton } from "@/components/integrations/sync-now-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    connected?: string;
    error?: string;
    warning?: string;
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "OAuth session expired or invalid. Please try again.",
  meta_exchange: "Meta rejected the authorization. Please try again.",
  forbidden: "You do not have access to that client.",
  not_configured:
    "Meta App credentials are not configured. Set META_APP_ID and META_APP_SECRET in your .env.",
  unknown: "Something went wrong. Please try again.",
};

type StatusDisplay = {
  label: string;
  variant: "success" | "warning" | "destructive" | "muted";
};

function resolveStatus(args: {
  hasToken: boolean;
  status: ConnectionStatus;
}): StatusDisplay {
  if (!args.hasToken) return { label: "Awaiting OAuth", variant: "muted" };
  switch (args.status) {
    case "ACTIVE":
      return { label: "Connected", variant: "success" };
    case "EXPIRED":
      return { label: "Token expired", variant: "warning" };
    case "REVOKED":
      return { label: "Revoked", variant: "muted" };
    case "ERROR":
      return { label: "Error", variant: "destructive" };
    default:
      return { label: "Error", variant: "destructive" };
  }
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const accessible = await getAccessibleClientIds(user);

  const connections = await db.adAccountConnection.findMany({
    where: {
      clientId: { in: accessible },
      platform: "META",
    },
    select: {
      id: true,
      clientId: true,
      platformAccountId: true,
      accountName: true,
      currency: true,
      timezone: true,
      status: true,
      lastSyncedAt: true,
      lastSyncError: true,
      accessTokenEnc: true,
      client: { select: { id: true, name: true } },
      _count: { select: { campaigns: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { createdAt: "asc" }],
  });

  const rows = connections.map((c) => ({
    id: c.id,
    clientId: c.clientId,
    clientName: c.client.name,
    platformAccountId: c.platformAccountId,
    accountName: c.accountName,
    currency: c.currency,
    timezone: c.timezone,
    status: c.status,
    lastSyncedAt: c.lastSyncedAt,
    lastSyncError: c.lastSyncError,
    campaignCount: c._count.campaigns,
    hasToken: Boolean(c.accessTokenEnc),
  }));

  const banner = (() => {
    if (searchParams.connected) {
      const n = Number(searchParams.connected);
      const count = Number.isFinite(n) && n > 0 ? n : 0;
      return (
        <Card className='border-emerald-500/30 bg-success/10 p-4 text-sm text-emerald-300'>
          Connected {count} ad account{count === 1 ? "" : "s"}.
        </Card>
      );
    }
    if (searchParams.error) {
      const msg = ERROR_MESSAGES[searchParams.error] ?? ERROR_MESSAGES.unknown;
      return (
        <Card className='border-red-500/30 bg-destructive/10 p-4 text-sm text-red-300'>
          {msg}
        </Card>
      );
    }
    if (searchParams.warning === "no_match") {
      return (
        <Card className='border-amber-500/30 bg-warning/10 p-4 text-sm text-amber-300'>
          No matching ad accounts found in your roster. Add the Meta ad account
          ID to a client first (Edit Client), then retry.
        </Card>
      );
    }
    return null;
  })();

  return (
    <div className='space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>Integrations</h1>
        <p className='text-sm text-muted-foreground'>
          Connect external ad platforms to your client workspaces.
        </p>
      </div>

      {banner}

      <div className='space-y-3'>
        <div className='flex items-center gap-2'>
          <h2 className='text-xl font-semibold tracking-tight'>Meta Ads</h2>
          <Badge variant='muted'>Read-only</Badge>
        </div>
        <p className='text-sm text-muted-foreground'>
          OAuth scopes: ads_read, business_management, read_insights. We never
          request write access.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title='No Meta ad accounts yet'
          description='No clients with a Meta ad account yet. Add one via the Add Client flow.'
        />
      ) : (
        <Card className='overflow-hidden'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Account name</TableHead>
                <TableHead>Account ID</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const s = resolveStatus({
                  hasToken: r.hasToken,
                  status: r.status,
                });
                return (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>
                      {r.clientName}
                    </TableCell>
                    <TableCell>
                      {r.accountName}
                      {r.lastSyncError && (
                        <div className='max-w-[260px] text-[11px] text-destructive'>
                          Last error: {r.lastSyncError}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className='font-mono text-xs'>
                        {r.platformAccountId}
                      </span>
                    </TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {r.timezone}
                    </TableCell>
                    <TableCell>{r.campaignCount}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant} withDot>
                        {s.label}
                      </Badge>
                      {r.hasToken && r.lastSyncedAt && (
                        <div className='mt-1 text-[10px] text-muted-foreground'>
                          synced{" "}
                          {formatDistanceToNow(r.lastSyncedAt, {
                            addSuffix: true,
                          })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {r.hasToken ? (
                        <div className='flex items-center justify-end gap-2'>
                          <SyncNowButton
                            connectionId={r.id}
                            firstSync={r.lastSyncedAt === null}
                          />
                          <DisconnectButton connectionId={r.id} />
                        </div>
                      ) : (
                        <ConnectMetaButton clientId={r.clientId} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
