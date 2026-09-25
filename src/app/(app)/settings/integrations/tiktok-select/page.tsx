import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isTikTokConnectEnabled } from "@/lib/tiktok/flags";
import { TIKTOK_PENDING_COOKIE } from "@/lib/tiktok/oauth-cookies";
import { loadPendingTikTokSession } from "@/server/tiktok-oauth-session";
import { confirmTikTokAdvertisers } from "@/server/tiktok-connect";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { error?: string };
}

const ERROR_MESSAGES: Record<string, string> = {
  tiktok_selection:
    "Select at least one advertiser from this TikTok authorization.",
  tiktok_conflict:
    "One or more selected advertisers are already connected to a different client. Nothing was connected.",
};

/**
 * Lists the advertisers a TikTok authorization can access and lets the user
 * connect a selection. The form submits advertiser ids only; the client,
 * profile and session are resolved server-side from the pending session. The
 * pending session's token (or its ciphertext) is never rendered or passed to
 * any component.
 */
export default async function TikTokSelectPage({ searchParams }: PageProps) {
  if (!isTikTokConnectEnabled()) {
    redirect("/settings/integrations?error=tiktok_disabled");
  }

  const user = await requireUser();
  const cookieId = cookies().get(TIKTOK_PENDING_COOKIE)?.value;
  const session = await loadPendingTikTokSession(cookieId, user.id);

  if (!session) {
    return (
      <div className='mx-auto max-w-2xl space-y-4'>
        <Card className='p-4 text-sm text-muted-foreground'>
          This TikTok authorization has expired. Start again from Integrations.
        </Card>
        <BackLink />
      </div>
    );
  }

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(session.clientId)) {
    redirect("/settings/integrations?error=tiktok_client");
  }

  const client = await db.client.findUnique({
    where: { id: session.clientId },
    select: { name: true },
  });
  if (!client) {
    redirect("/settings/integrations?error=tiktok_client");
  }

  const errorMessage = searchParams.error
    ? ERROR_MESSAGES[searchParams.error]
    : undefined;

  return (
    <div className='mx-auto max-w-3xl space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          TikTok advertisers
        </h1>
        <p className='text-sm text-muted-foreground'>
          Advertisers this TikTok authorization can access, for client{" "}
          <span className='font-medium text-foreground'>{client.name}</span>.
        </p>
      </div>

      {errorMessage && (
        <Card className='border-red-500/30 bg-destructive/10 p-4 text-sm text-red-300'>
          {errorMessage}
        </Card>
      )}

      <form action={confirmTikTokAdvertisers} className='space-y-4'>
        <Card className='overflow-hidden'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <span className='sr-only'>Select</span>
                </TableHead>
                <TableHead>Advertiser</TableHead>
                <TableHead>Advertiser ID</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Timezone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {session.advertisers.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <input
                      type='checkbox'
                      name='advertiserId'
                      value={a.id}
                      className='h-4 w-4 rounded border-input'
                      aria-label={`Select ${a.name}`}
                    />
                  </TableCell>
                  <TableCell className='font-medium'>{a.name}</TableCell>
                  <TableCell>
                    <span className='font-mono text-xs'>{a.id}</span>
                  </TableCell>
                  <TableCell>{a.currency}</TableCell>
                  {/* Verbatim: "Etc/GMT-2" means UTC+2. Never reinterpret. */}
                  <TableCell className='text-muted-foreground'>
                    {a.timezone}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Button type='submit' size='sm'>
          Connect selected
        </Button>
      </form>

      <BackLink />
    </div>
  );
}

function BackLink() {
  return (
    <div className='pt-2'>
      <Button asChild variant='link' size='sm' className='px-0'>
        <Link href='/settings/integrations'>Back to integrations</Link>
      </Button>
    </div>
  );
}
