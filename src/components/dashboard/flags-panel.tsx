import { FlagCard } from "@/components/dashboard/flag-card";
import { AllClear } from "@/components/dashboard/all-clear";
import type { Flag } from "@/lib/dashboard-flags";

const MAX_CARDS = 3;

export function FlagsPanel({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) {
    return <AllClear />;
  }

  const visible = flags.slice(0, MAX_CARDS);
  const overflow = flags.length - visible.length;

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {visible.map((flag) => (
          <FlagCard
            key={`${flag.clientId}-${flag.severity}-${flag.label}`}
            flag={flag}
          />
        ))}
      </div>
      {overflow > 0 && (
        <div className='flex justify-end'>
          <span className='inline-flex items-center rounded-full border border-border/60 bg-secondary/60 px-2.5 py-1 text-xs font-medium text-muted-foreground'>
            +{overflow} more need attention
          </span>
        </div>
      )}
    </div>
  );
}
