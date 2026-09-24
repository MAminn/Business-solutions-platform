"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClientOption {
  id: string;
  name: string;
}

interface ProfileOption {
  id: string;
  name: string;
}

interface Props {
  clients: ClientOption[];
  profiles: ProfileOption[];
}

/**
 * Launches the TikTok OAuth flow for an accessible client + TikTok app
 * profile. TikTok counterpart of ConnectClientLauncher. Only rendered when the
 * TikTok connect kill switch is on.
 */
export function ConnectTikTokLauncher({ clients, profiles }: Props) {
  const [clientId, setClientId] = useState("");
  const [profileId, setProfileId] = useState(
    profiles.length === 1 ? profiles[0]!.id : "",
  );

  const ready = Boolean(clientId && profileId);
  const href = ready
    ? `/api/tiktok/oauth/start?clientId=${encodeURIComponent(
        clientId,
      )}&tiktokAppProfileId=${encodeURIComponent(profileId)}`
    : undefined;

  if (profiles.length === 0) {
    return (
      <Card className='p-4 text-sm text-muted-foreground'>
        Add a TikTok App Profile above before connecting a client.
      </Card>
    );
  }

  if (clients.length === 0) {
    return (
      <Card className='p-4 text-sm text-muted-foreground'>
        No clients available. Create a client first.
      </Card>
    );
  }

  return (
    <Card className='space-y-3 p-4'>
      <p className='text-sm font-medium'>Connect a client to TikTok</p>
      <p className='text-xs text-muted-foreground'>
        Authorize TikTok for a client, then review which advertisers it can
        access.
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className='h-9 w-[220px] text-sm'>
            <SelectValue placeholder='Select client' />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className='h-9 w-[200px] text-sm'>
            <SelectValue placeholder='Select TikTok App' />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button asChild size='sm' disabled={!ready}>
          {href ? (
            <a href={href}>Connect TikTok</a>
          ) : (
            <span>Connect TikTok</span>
          )}
        </Button>
      </div>
    </Card>
  );
}
