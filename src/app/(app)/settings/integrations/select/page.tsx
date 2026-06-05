import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  META_PENDING_COOKIE,
  parsePendingSession,
} from "@/lib/meta/pending-session";
import {
  AdAccountSelection,
  type SelectableAccount,
} from "@/components/integrations/ad-account-selection";

export const dynamic = "force-dynamic";

async function getOrgIdForUser(userId: string): Promise<string | null> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

export default async function SelectAdAccountsPage() {
  const user = await requireUser();

  const session = parsePendingSession(
    cookies().get(META_PENDING_COOKIE)?.value,
  );
  if (!session) {
    redirect("/settings/integrations?error=invalid_state");
  }

  // Re-validate access on render (defense in depth — the confirm action
  // re-checks too).
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(session.clientId)) {
    redirect("/settings/integrations?error=forbidden");
  }

  const organizationId = await getOrgIdForUser(user.id);
  if (!organizationId) {
    redirect("/settings/integrations?error=unknown");
  }

  const [client, profile, existingConnections] = await Promise.all([
    db.client.findUnique({
      where: { id: session.clientId },
      select: { id: true, name: true },
    }),
    db.metaAppProfile.findFirst({
      where: { id: session.metaAppProfileId, organizationId },
      select: { id: true, name: true },
    }),
    db.adAccountConnection.findMany({
      where: {
        platform: "META",
        platformAccountId: { in: session.accounts.map((a) => a.id) },
      },
      select: { platformAccountId: true, clientId: true },
    }),
  ]);

  if (!client || !profile) {
    redirect("/settings/integrations?error=invalid_state");
  }

  const linkedClientByAccount = new Map(
    existingConnections.map((c) => [c.platformAccountId, c.clientId]),
  );

  const accounts: SelectableAccount[] = session.accounts.map((a) => {
    const linkedClientId = linkedClientByAccount.get(a.id);
    return {
      id: a.id,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      alreadyLinkedToThisClient: linkedClientId === session.clientId,
      linkedToOtherClient:
        linkedClientId !== undefined && linkedClientId !== session.clientId,
    };
  });

  return (
    <div className='mx-auto max-w-2xl space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          Select ad accounts
        </h1>
        <p className='text-sm text-muted-foreground'>
          These are all the Meta ad accounts your authorization can access.
        </p>
      </div>

      <AdAccountSelection
        clientName={client.name}
        profileName={profile.name}
        accounts={accounts}
      />

      <div className='pt-2'>
        <Button asChild variant='link' size='sm' className='px-0'>
          <Link href='/settings/integrations'>Back to integrations</Link>
        </Button>
      </div>
    </div>
  );
}
