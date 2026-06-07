"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { buildAccountDigest } from "@/server/digest";

interface Props {
  connectionId: string;
}

export function GenerateDigestButton({ connectionId }: Props) {
  const [pending, startTransition] = useTransition();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = (): void => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const md = await buildAccountDigest(connectionId);
        setMarkdown(md);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate digest");
      }
    });
  };

  const handleCopy = async (): Promise<void> => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={handleGenerate}
          disabled={pending}>
          {pending ? "Generating…" : "Generate digest"}
        </Button>
        {markdown && (
          <Button size='sm' variant='outline' onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>

      {error && <p className='text-[11px] text-destructive'>{error}</p>}

      {markdown && (
        <textarea
          readOnly
          value={markdown}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className='h-64 w-full resize-y rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-ring'
        />
      )}
    </div>
  );
}
