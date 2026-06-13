"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AnalysisLevel, AnalysisPreset } from "@/server/analysis";

const PRESETS: ReadonlyArray<{ value: AnalysisPreset; label: string }> = [
  { value: "7", label: "Last 7" },
  { value: "30", label: "Last 30" },
  { value: "prev_month", label: "Previous month" },
  { value: "custom", label: "Custom" },
];

const LEVELS: ReadonlyArray<{ value: AnalysisLevel; label: string }> = [
  { value: "ACCOUNT", label: "Account" },
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "AD", label: "Ad" },
];

interface AnalysisToolbarProps {
  preset: AnalysisPreset;
  level: AnalysisLevel;
  start: string;
  end: string;
  latestDataDate: string | null;
}

export function AnalysisToolbar({
  preset,
  level,
  start,
  end,
  latestDataDate,
}: AnalysisToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-x-6 gap-y-4",
        isPending && "opacity-60",
      )}>
      {/* Date range presets */}
      <div className='space-y-1.5'>
        <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
          Date range
        </p>
        <div className='inline-flex rounded-md border border-border bg-background p-0.5'>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type='button'
              onClick={() => setParams({ preset: p.value })}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                preset === p.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {preset === "custom" && (
        <div className='space-y-1.5'>
          <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
            From / To
          </p>
          <div className='flex items-center gap-2'>
            <input
              type='date'
              defaultValue={start}
              max={latestDataDate ?? undefined}
              onChange={(e) =>
                e.target.value && setParams({ start: e.target.value })
              }
              className='h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            />
            <span className='text-xs text-muted-foreground'>→</span>
            <input
              type='date'
              defaultValue={end}
              max={latestDataDate ?? undefined}
              onChange={(e) =>
                e.target.value && setParams({ end: e.target.value })
              }
              className='h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            />
          </div>
        </div>
      )}

      {/* Level toggle */}
      <div className='space-y-1.5'>
        <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
          Level
        </p>
        <div className='inline-flex rounded-md border border-border bg-background p-0.5'>
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type='button'
              onClick={() => setParams({ level: l.value })}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                level === l.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
