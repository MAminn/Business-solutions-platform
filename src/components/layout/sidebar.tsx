"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Image as ImageIcon,
  BarChart3,
  ListChecks,
  AlertCircle,
  Settings,
} from "lucide-react";

interface SidebarUser {
  name: string;
  role: string;
}

const navSections: Array<{
  label: string;
  items: Array<{ href: string; label: string; icon: React.ElementType }>;
}> = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/ops", label: "Ops & Tasks", icon: ListChecks },
      { href: "/alerts", label: "Alerts", icon: AlertCircle },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/integrations", label: "Integrations", icon: Settings },
    ],
  },
];

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();

  return (
    <aside className='flex h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-card/40'>
      {/* Brand */}
      <div className='flex h-16 items-center gap-3 border-b border-border/60 px-5'>
        <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-accent'>
          <span className='text-sm font-bold tracking-tight text-accent-foreground'>
            LP
          </span>
        </div>
        <div className='flex flex-col leading-tight'>
          <span className='text-sm font-semibold'>Loopa</span>
          <span className='text-[11px] text-muted-foreground'>
            Media Buyer OS
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className='flex-1 space-y-6 overflow-y-auto px-3 py-6'>
        {navSections.map((section) => (
          <div key={section.label}>
            <p className='px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70'>
              {section.label}
            </p>
            <ul className='space-y-0.5'>
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                      )}>
                      <Icon className='h-4 w-4' />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User card */}
      <div className='border-t border-border/60 px-3 py-4'>
        <div className='flex items-center gap-3 rounded-md px-2 py-2'>
          <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'>
            {user.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className='min-w-0 leading-tight'>
            <p className='truncate text-sm font-medium'>{user.name}</p>
            <p className='truncate text-[11px] text-muted-foreground'>
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
