"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncConnectionNow } from "@/server/sync";

interface Props {
  connectionId: string;
  firstSync: boolean;
}

export function SyncNowButton({ connectionId, firstSync }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = firstSync ? "Initial sync (30d)" : "Sync now";
  const pendingLabel = firstSync ? "Syncing 30 days…" : "Syncing…";

  const handleClick = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncConnectionNow({ connectionId });
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      }
    });
  };

  return (
    <div className='flex flex-col items-end gap-1'>
      <Button
        size='sm'
        variant={firstSync ? "default" : "outline"}
        onClick={handleClick}
        disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {error && (
        <p className='max-w-[220px] text-right text-[11px] text-destructive'>
          {error}
        </p>
      )}
    </div>
  );
}
