import type { TaskPriority, TaskStatus, TaskSource } from "@prisma/client";
import { Paperclip } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { MoveTaskButton } from "@/components/tasks/move-task-button";

export interface KanbanAttachment {
  id: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description?: string | null;
  rule: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  client: { id: string; name: string };
  createdAt: Date;
  attachments?: KanbanAttachment[];
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
                      {task.description && task.description.length > 0 && (
                        <p className='mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground'>
                          {task.description}
                        </p>
                      )}
                      {subtitle.length > 0 && (
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {subtitle}
                        </p>
                      )}
                      {task.attachments && task.attachments.length > 0 && (
                        <ul className='mt-2 space-y-1'>
                          {task.attachments.map((att) => (
                            <li key={att.id}>
                              <a
                                href={att.url}
                                target='_blank'
                                rel='noopener noreferrer'
                                download={att.fileName}
                                className='inline-flex max-w-full items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline'>
                                <Paperclip className='h-3 w-3 shrink-0' />
                                <span className='truncate'>{att.fileName}</span>
                                <span className='shrink-0 text-muted-foreground'>
                                  ({formatBytes(att.size)})
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
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
