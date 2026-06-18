"use client";

import { useTransition } from "react";
import { cancelFundingCycle } from "@/server/funding";
import { Button } from "@/components/ui/button";

export function FundingCancelButton({
  fundingCycleId,
}: {
  fundingCycleId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type='button'
      size='sm'
      variant='outline'
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            "Cancel this funding cycle? It stays on record but is no longer the active cycle.",
          )
        ) {
          return;
        }
        startTransition(async () => {
          await cancelFundingCycle({ fundingCycleId });
        });
      }}>
      {pending ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
