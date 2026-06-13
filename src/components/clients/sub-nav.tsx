import Link from "next/link";
import { cn } from "@/lib/utils";

export const CLIENT_SUB_TABS = [
  { label: "Overview", segment: "" },
  { label: "Analysis", segment: "analysis" },
  { label: "Strategy", segment: "strategy" },
  { label: "Campaigns", segment: "campaigns" },
  { label: "Creatives", segment: "creatives" },
  { label: "Tasks", segment: "tasks" },
  { label: "Ad Account", segment: "ad-account" },
] as const;

export type ClientSubTabSegment = (typeof CLIENT_SUB_TABS)[number]["segment"];

interface ClientSubNavProps {
  clientId: string;
  active: ClientSubTabSegment;
}

export function ClientSubNav({ clientId, active }: ClientSubNavProps) {
  return (
    <nav className='flex items-center gap-1 border-b border-border/60'>
      {CLIENT_SUB_TABS.map((tab) => {
        const href = tab.segment
          ? `/clients/${clientId}/${tab.segment}`
          : `/clients/${clientId}`;
        const isActive = tab.segment === active;
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "-mb-px inline-flex items-center border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
