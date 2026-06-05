"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ConnectProfileOption {
  id: string;
  name: string;
  apiVersion: string;
}

interface Props {
  clientId: string;
  profiles: ConnectProfileOption[];
}

export function ConnectMetaButton({ clientId, profiles }: Props) {
  const [profileId, setProfileId] = useState<string>(
    profiles.length === 1 ? profiles[0]!.id : "",
  );

  // No workspace app configured yet — point the user at the profiles section.
  if (profiles.length === 0) {
    return (
      <Button asChild size='sm' variant='outline'>
        <a href='#meta-app-profiles'>Add a Meta App first</a>
      </Button>
    );
  }

  const href =
    profileId &&
    `/api/meta/oauth/start?clientId=${encodeURIComponent(
      clientId,
    )}&metaAppProfileId=${encodeURIComponent(profileId)}`;

  return (
    <div className='flex items-center justify-end gap-2'>
      <Select value={profileId} onValueChange={setProfileId}>
        <SelectTrigger className='h-8 w-[160px] text-xs'>
          <SelectValue placeholder='Select app' />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button asChild size='sm' disabled={!profileId}>
        {href ? <a href={href}>Connect</a> : <span>Connect</span>}
      </Button>
    </div>
  );
}
