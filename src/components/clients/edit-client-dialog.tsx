"use client";

import * as React from "react";
import type { ClientStatus, ClientHealth } from "@prisma/client";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updateClient } from "@/server/clients";
import type { ClientFormState } from "@/server/clients.schemas";

export interface EditClientDialogClient {
  id: string;
  name: string;
  industry: string | null;
  logoUrl: string | null;
  monthlyBudget: number | null;
  minRoas: number | null;
  minCpa: number | null;
  maxCpa: number | null;
  notes: string | null;
  // Carried through unchanged — not user-editable in this commit.
  status: ClientStatus;
  health: ClientHealth;
}

interface EditClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: EditClientDialogClient;
}

function toInput(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

interface FieldProps {
  id: string;
  label: string;
  type?: "text" | "number" | "url";
  step?: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}

function Field({
  id,
  label,
  type = "text",
  step,
  required,
  placeholder,
  value,
  onChange,
  errors,
}: FieldProps) {
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>
        {label}
        {required && <span className='ml-1 text-destructive'>*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        step={step}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
      />
      {errors && errors.length > 0 && (
        <p id={errorId} className='text-xs text-destructive'>
          {errors[0]}
        </p>
      )}
    </div>
  );
}

export function EditClientDialog({
  open,
  onOpenChange,
  client,
}: EditClientDialogProps) {
  const [name, setName] = React.useState(client.name);
  const [industry, setIndustry] = React.useState(client.industry ?? "");
  const [logoUrl, setLogoUrl] = React.useState(client.logoUrl ?? "");
  const [monthlyBudget, setMonthlyBudget] = React.useState(
    toInput(client.monthlyBudget),
  );
  const [minRoas, setMinRoas] = React.useState(toInput(client.minRoas));
  const [minCpa, setMinCpa] = React.useState(toInput(client.minCpa));
  const [maxCpa, setMaxCpa] = React.useState(toInput(client.maxCpa));
  const [notes, setNotes] = React.useState(client.notes ?? "");
  const [status, setStatus] = React.useState<ClientStatus>(client.status);

  const [errors, setErrors] = React.useState<ClientFormState["errors"]>({});
  const [isPending, startTransition] = React.useTransition();

  // Reset the form to the client's current values whenever the sheet opens.
  React.useEffect(() => {
    if (!open) return;
    setName(client.name);
    setIndustry(client.industry ?? "");
    setLogoUrl(client.logoUrl ?? "");
    setMonthlyBudget(toInput(client.monthlyBudget));
    setMinRoas(toInput(client.minRoas));
    setMinCpa(toInput(client.minCpa));
    setMaxCpa(toInput(client.maxCpa));
    setNotes(client.notes ?? "");
    setStatus(client.status);
    setErrors({});
  }, [open, client]);

  const fieldErrors = errors ?? {};

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateClient({
        id: client.id,
        name,
        industry,
        logoUrl,
        monthlyBudget,
        minRoas,
        minCpa,
        maxCpa,
        notes,
        // Selected by the user in the dialog.
        status,
        // Passed straight through, unchanged — health stays derived.
        health: client.health,
      });

      if ("ok" in result) {
        onOpenChange(false);
        return;
      }
      setErrors(result.errors ?? {});
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='gap-0'>
        <div className='border-b border-border/60 px-6 py-5'>
          <SheetTitle>Edit client</SheetTitle>
          <SheetDescription>
            Update {client.name}&rsquo;s profile and KPI targets.
          </SheetDescription>
        </div>

        <form onSubmit={handleSubmit} className='flex min-h-0 flex-1 flex-col'>
          <div className='flex-1 space-y-5 overflow-y-auto px-6 py-5'>
            <Field
              id='edit-client-name'
              label='Client name'
              required
              placeholder='e.g. Lumen Skincare'
              value={name}
              onChange={setName}
              errors={fieldErrors.name}
            />
            <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='edit-client-status'>Status</Label>
                <select
                  id='edit-client-status'
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ClientStatus)}
                  className={cn(
                    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}>
                  <option value='ACTIVE'>Active</option>
                  <option value='PAUSED'>Paused</option>
                  <option value='CHURNED'>Churned</option>
                  <option value='PROSPECT'>Prospect</option>
                </select>
              </div>
              <Field
                id='edit-client-industry'
                label='Industry'
                placeholder='e.g. Beauty / DTC'
                value={industry}
                onChange={setIndustry}
                errors={fieldErrors.industry}
              />
              <Field
                id='edit-client-logo-url'
                label='Logo URL'
                type='url'
                placeholder='https://…'
                value={logoUrl}
                onChange={setLogoUrl}
                errors={fieldErrors.logoUrl}
              />
              <Field
                id='edit-client-monthly-budget'
                label='Monthly budget'
                type='number'
                step='0.01'
                placeholder='0'
                value={monthlyBudget}
                onChange={setMonthlyBudget}
                errors={fieldErrors.monthlyBudget}
              />
              <Field
                id='edit-client-min-roas'
                label='Alert if ROAS drops below'
                type='number'
                step='0.01'
                placeholder='0.00'
                value={minRoas}
                onChange={setMinRoas}
                errors={fieldErrors.minRoas}
              />
              <Field
                id='edit-client-min-cpa'
                label='Ideal CPA target'
                type='number'
                step='0.01'
                placeholder='0'
                value={minCpa}
                onChange={setMinCpa}
                errors={fieldErrors.minCpa}
              />
              <Field
                id='edit-client-max-cpa'
                label='Alert if CPA exceeds'
                type='number'
                step='0.01'
                placeholder='0'
                value={maxCpa}
                onChange={setMaxCpa}
                errors={fieldErrors.maxCpa}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='edit-client-notes'>Notes</Label>
              <textarea
                id='edit-client-notes'
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder='Internal notes…'
                className={cn(
                  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
            </div>

            {fieldErrors._form && fieldErrors._form.length > 0 && (
              <p className='text-sm text-destructive'>{fieldErrors._form[0]}</p>
            )}
          </div>

          <div className='flex items-center justify-end gap-2 border-t border-border/60 px-6 py-4'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isPending}>
              Cancel
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
