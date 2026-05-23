import type { TaskPriority, TaskStatus, TaskSource } from "@prisma/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { MoveTaskButton } from "@/components/tasks/move-task-button";

export interface KanbanTask {
  id: string;
  title: string;
  rule: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  client: { id: string; name: string };
  createdAt: Date;
}

interface KanbanBoardProps {
  tasks: KanbanTask[];
  showClient?: boolean;
  emptyDescription?: string;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  MED: 2,
  LOW: 1,
};

const PRIORITY_VARIANT: Record<
  TaskPriority,
  "destructive" | "warning" | "muted"
> = {
  URGENT: "destructive",
  HIGH: "destructive",
  MED: "warning",
  LOW: "muted",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MED: "Med",
  LOW: "Low",
};

const COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "DONE", label: "Done" },
];

function sortTasks(a: KanbanTask, b: KanbanTask): number {
  const diff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (diff !== 0) return diff;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function KanbanBoard({
  tasks,
  showClient = false,
  emptyDescription = "Create a task to get started.",
}: KanbanBoardProps) {
  if (tasks.length === 0) {
    return <EmptyState title='No tasks yet' description={emptyDescription} />;
  }

  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
      {COLUMNS.map((col) => {
        const colTasks = tasks
          .filter((t) => t.status === col.key)
          .sort(sortTasks);
        return (
          <div key={col.key} className='space-y-3'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                {col.label}
              </h3>
              <Badge variant='muted'>{colTasks.length}</Badge>
            </div>
            <div className='space-y-3'>
              {colTasks.length === 0 ? (
                <div className='flex h-12 items-center justify-center text-sm text-muted-foreground'>
                  —
                </div>
              ) : (
                colTasks.map((task) => {
                  const subtitle = showClient
                    ? task.client.name
                    : (task.rule ?? "");
                  const showRuleRow =
                    showClient && task.rule !== null && task.rule.length > 0;
                  return (
                    <Card key={task.id} className='p-4'>
                      <div className='flex items-start justify-between gap-2'>
                        <Badge
                          variant={PRIORITY_VARIANT[task.priority]}
                          withDot>
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                        <MoveTaskButton
                          taskId={task.id}
                          currentStatus={task.status}
                        />
                      </div>
                      <p className='mt-2 text-sm font-medium leading-snug'>
                        {task.title}
                      </p>
                      {subtitle.length > 0 && (
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {subtitle}
                        </p>
                      )}
                      {showRuleRow && (
                        <p className='mt-2 flex items-center gap-1.5'>
                          <span className='font-mono text-[10px] uppercase tracking-wider text-muted-foreground'>
                            RULE
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {task.rule}
                          </span>
                        </p>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
