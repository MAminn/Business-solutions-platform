"use client";

import { Button } from "@/components/ui/button";

interface Props {
  clientId: string;
}

export function ConnectMetaButton({ clientId }: Props) {
  const href = `/api/meta/oauth/start?clientId=${encodeURIComponent(clientId)}`;
  return (
    <Button asChild size='sm'>
      <a href={href}>Connect</a>
    </Button>
  );
}
