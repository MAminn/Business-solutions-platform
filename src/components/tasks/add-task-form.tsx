"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { TaskPriority } from "@prisma/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTask } from "@/server/tasks";
import type { TaskFormState } from "@/server/tasks.schemas";

const initialState: TaskFormState = {};

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "MED", label: "Med" },
  { value: "LOW", label: "Low" },
];

interface AddTaskFormProps {
  clients: Array<{ id: string; name: string }>;
  defaultClientId?: string;
  hideClientPicker?: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type='submit' size='sm' disabled={pending}>
      {pending ? "Adding…" : "Add task"}
    </Button>
  );
}

export function AddTaskForm({
  clients,
  defaultClientId,
  hideClientPicker = false,
}: AddTaskFormProps) {
  const [state, formAction] = useFormState(createTask, initialState);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (state.message) {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state.message]);

  const selectClasses =
    "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Card className='p-4'>
      <form
        key={state.message ?? "form"}
        action={formAction}
        className='space-y-3'>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end'>
          <div className={hideClientPicker ? "md:col-span-8" : "md:col-span-5"}>
            <Label htmlFor='task-title'>Title</Label>
            <Input
              id='task-title'
              name='title'
              type='text'
              required
              maxLength={200}
              placeholder='What needs to happen?'
              className='mt-1.5'
            />
            {state.errors?.title && (
              <p className='mt-1 text-xs text-destructive'>
                {state.errors.title[0]}
              </p>
            )}
          </div>

          <div className='md:col-span-2'>
            <Label htmlFor='task-priority'>Priority</Label>
            <select
              id='task-priority'
              name='priority'
              defaultValue='MED'
              className={`mt-1.5 ${selectClasses}`}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {state.errors?.priority && (
              <p className='mt-1 text-xs text-destructive'>
                {state.errors.priority[0]}
              </p>
            )}
          </div>

          {hideClientPicker ? (
            <input
              type='hidden'
              name='clientId'
              value={defaultClientId ?? ""}
            />
          ) : (
            <div className='md:col-span-3'>
              <Label htmlFor='task-client'>Client</Label>
              <select
                id='task-client'
                name='clientId'
                defaultValue={defaultClientId ?? clients[0]?.id ?? ""}
                required
                className={`mt-1.5 ${selectClasses}`}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {state.errors?.clientId && (
                <p className='mt-1 text-xs text-destructive'>
                  {state.errors.clientId[0]}
                </p>
              )}
            </div>
          )}

          <div className='md:col-span-2'>
            <SubmitButton />
          </div>
        </div>

        {state.errors?._form && (
          <p className='text-xs text-destructive'>{state.errors._form[0]}</p>
        )}
        {showSuccess && state.message && (
          <p className='text-xs text-muted-foreground'>{state.message}</p>
        )}
      </form>
    </Card>
  );
}
