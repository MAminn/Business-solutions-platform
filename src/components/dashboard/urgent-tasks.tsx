import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@prisma/client";

interface UrgentTask {
  id: string;
  title: string;
  client: string;
  rule: string | null;
  priority: TaskPriority;
}

const priorityStyle: Record<TaskPriority, { dot: string; label: string; text: string }> = {
  URGENT: { dot: "bg-red-500", label: "Urgent", text: "text-red-400" },
  HIGH: { dot: "bg-red-500", label: "High", text: "text-red-400" },
  MED: { dot: "bg-amber-500", label: "Med", text: "text-amber-400" },
  LOW: { dot: "bg-muted-foreground", label: "Low", text: "text-muted-foreground" },
};

export function UrgentTasks({ tasks }: { tasks: UrgentTask[] }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold">Urgent tasks</h3>
        <Link href="/ops" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>
      <ul className="space-y-2.5">
        {tasks.length === 0 && (
          <li className="text-sm text-muted-foreground">No urgent tasks. Nice work.</li>
        )}
        {tasks.map((t) => {
          const p = priorityStyle[t.priority];
          return (
            <li
              key={t.id}
              className="rounded-lg border border-border/40 bg-secondary/30 p-3 hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium",
                    p.text
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", p.dot)} />
                  {p.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{t.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.client}
                    {t.rule ? ` · ${t.rule}` : ""}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
