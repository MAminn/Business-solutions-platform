"use client";

import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { updateTaskStatus, deleteTask } from "@/server/tasks";

interface MoveTaskButtonProps {
  taskId: string;
  currentStatus: TaskStatus;
}

const MOVE_OPTIONS: Array<{ label: string; status: TaskStatus }> = [
  { label: "Move to To do", status: "TODO" },
  { label: "Move to In progress", status: "IN_PROGRESS" },
  { label: "Move to Done", status: "DONE" },
];

export function MoveTaskButton({ taskId, currentStatus }: MoveTaskButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleMove = (status: TaskStatus): void => {
    startTransition(async () => {
      try {
        await updateTaskStatus({ id: taskId, status });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[move-task] failed", err);
      }
    });
  };

  const handleDelete = (): void => {
    startTransition(async () => {
      try {
        await deleteTask({ id: taskId });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[delete-task] failed", err);
      }
    });
  };

  const moveOptions = MOVE_OPTIONS.filter((o) => o.status !== currentStatus);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='ghost'
          aria-label='Move task'
          disabled={isPending}
          className='h-7 w-7 p-0'>
          <MoreHorizontal className='h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {moveOptions.map((o) => (
          <DropdownMenuItem
            key={o.status}
            onSelect={() => handleMove(o.status)}>
            {o.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleDelete}
          className='text-destructive focus:text-destructive'>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
