"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  confirmMetaAdAccounts,
  cancelMetaConnection,
} from "@/server/meta-connect";

export interface SelectableAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  alreadyLinkedToThisClient: boolean;
  linkedToOtherClient: boolean;
}

interface Props {
  clientName: string;
  profileName: string;
  accounts: SelectableAccount[];
}

export function AdAccountSelection({
  clientName,
  profileName,
  accounts,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Pre-select accounts already linked to this client; disable ones linked
  // elsewhere (globally unique platformAccountId).
  const initial = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.alreadyLinkedToThisClient) set.add(a.id);
    }
    return set;
  }, [accounts]);

  const [selected, setSelected] = useState<Set<string>>(initial);

  const toggle = (id: string, disabled: boolean): void => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = (): void => {
    setError(null);
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError("Select at least one ad account.");
      return;
    }
    startTransition(async () => {
      const result = await confirmMetaAdAccounts({ selectedAccountIds: ids });
      if (result.ok) {
        router.push(`/settings/integrations?connected=${result.created}`);
      } else {
        setError(result.error);
      }
    });
  };

  const handleCancel = (): void => {
    startTransition(async () => {
      await cancelMetaConnection();
      router.push("/settings/integrations?warning=cancelled");
    });
  };

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground'>
        Authorized via{" "}
        <span className='font-medium text-foreground'>{profileName}</span>.
        Choose which ad accounts to link to{" "}
        <span className='font-medium text-foreground'>{clientName}</span>. Only
        the accounts you select will have a connection created.
      </div>

      <ul className='divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60'>
        {accounts.map((a) => {
          const disabled = a.linkedToOtherClient;
          const isChecked = selected.has(a.id);
          return (
            <li
              key={a.id}
              className={
                "flex items-center gap-3 p-4 " +
                (disabled ? "opacity-60" : "cursor-pointer hover:bg-accent/40")
              }
              onClick={() => toggle(a.id, disabled)}>
              <input
                type='checkbox'
                checked={isChecked}
                disabled={disabled}
                onChange={() => toggle(a.id, disabled)}
                onClick={(e) => e.stopPropagation()}
                className='h-4 w-4 rounded border-input'
                aria-label={`Select ${a.name}`}
              />
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium'>{a.name}</span>
                  {a.alreadyLinkedToThisClient && (
                    <Badge variant='info'>Already linked</Badge>
                  )}
                  {a.linkedToOtherClient && (
                    <Badge variant='muted'>Linked to another client</Badge>
                  )}
                </div>
                <div className='mt-0.5 truncate font-mono text-xs text-muted-foreground'>
                  {a.id} · {a.currency} · {a.timezone}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <div className='flex items-center gap-3'>
        <Button onClick={handleConfirm} disabled={pending}>
          {pending
            ? "Linking…"
            : `Link ${selected.size || ""} account${selected.size === 1 ? "" : "s"}`.trim()}
        </Button>
        <Button variant='outline' onClick={handleCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
