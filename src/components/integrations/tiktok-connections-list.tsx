import { format } from "date-fns";
import type { ConnectionStatus } from "@prisma/client";
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
import { DisconnectButton } from "@/components/integrations/disconnect-button";

/**
 * Display-only TikTok connection row. Carries token PRESENCE only — never the
 * encrypted token or anything derived from it.
 */
export interface TikTokConnectionRow {
  id: string;
  clientName: string;
  platformAccountId: string;
  accountName: string;
  profileName: string | null;
  currency: string;
  timezone: string;
  status: ConnectionStatus;
  hasToken: boolean;
  createdAt: Date;
}

const STATUS_DISPLAY: Record<
  ConnectionStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "muted" }
> = {
  ACTIVE: { label: "Connected", variant: "success" },
  EXPIRED: { label: "Token expired", variant: "warning" },
  REVOKED: { label: "Revoked", variant: "muted" },
  ERROR: { label: "Error", variant: "destructive" },
};

interface Props {
  rows: TikTokConnectionRow[];
}

// No sync, export or digest controls: the TikTok pipeline does not exist yet.
// Disconnect is shown whenever a token is present, regardless of status.
export function TikTokConnectionsList({ rows }: Props) {
  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <h2 className='text-xl font-semibold tracking-tight'>
          TikTok ad accounts
        </h2>
        <Badge variant='muted'>Read-only</Badge>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title='No TikTok ad accounts yet'
          description='No clients are linked to a TikTok advertiser yet.'
        />
      ) : (
        <Card className='overflow-hidden'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Account name</TableHead>
                <TableHead>Advertiser ID</TableHead>
                <TableHead>App profile</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const s = STATUS_DISPLAY[r.status];
                return (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>
                      {r.clientName}
                    </TableCell>
                    <TableCell>{r.accountName}</TableCell>
                    <TableCell>
                      <span className='font-mono text-xs'>
                        {r.platformAccountId}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.profileName ? (
                        <span className='text-xs'>{r.profileName}</span>
                      ) : (
                        <span className='text-xs text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {r.timezone}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.variant} withDot>
                        {s.label}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {format(r.createdAt, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className='text-right'>
                      {r.hasToken ? (
                        <DisconnectButton connectionId={r.id} />
                      ) : null}
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
