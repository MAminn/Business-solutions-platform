"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectAdAccount } from "@/server/integrations";

interface Props {
  connectionId: string;
}

export function DisconnectButton({ connectionId }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleClick = (): void => {
    startTransition(async () => {
      try {
        await disconnectAdAccount({ id: connectionId });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[disconnect-ad-account] failed", err);
      }
    });
  };

  return (
    <Button
      size='sm'
      variant='outline'
      onClick={handleClick}
      disabled={isPending}>
      {isPending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}
