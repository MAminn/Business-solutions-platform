"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/server/clients";
import type { ClientFormState } from "@/server/clients.schemas";

const initialState: ClientFormState = {};

interface FieldProps {
  id: string;
  label: string;
  name: string;
  type?: "text" | "number";
  step?: string;
  required?: boolean;
  placeholder?: string;
  errors?: string[];
}

function Field({
  id,
  label,
  name,
  type = "text",
  step,
  required,
  placeholder,
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
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        required={required}
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type='submit' disabled={pending}>
      {pending ? "Creating..." : "Create client"}
    </Button>
  );
}

export function ClientForm() {
  const [state, formAction] = useFormState(createClient, initialState);
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className='space-y-6'>
      <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
        <div className='md:col-span-2'>
          <Field
            id='client-name'
            label='Client name'
            name='name'
            required
            placeholder='e.g. Lumen Skincare'
            errors={errors.name}
          />
        </div>
        <div className='md:col-span-2'>
          <Field
            id='client-industry'
            label='Industry'
            name='industry'
            placeholder='e.g. Beauty / DTC'
            errors={errors.industry}
          />
        </div>
        <Field
          id='client-monthly-budget'
          label='Monthly budget (USD)'
          name='monthlyBudget'
          type='number'
          step='0.01'
          placeholder='0'
          errors={errors.monthlyBudget}
        />
        <Field
          id='client-target-cpa'
          label='Target CPA (USD)'
          name='targetCpa'
          type='number'
          step='0.01'
          placeholder='0'
          errors={errors.targetCpa}
        />
        <Field
          id='client-target-roas'
          label='Target ROAS (x)'
          name='targetRoas'
          type='number'
          step='0.01'
          placeholder='0.00'
          errors={errors.targetRoas}
        />
      </div>

      {errors._form && errors._form.length > 0 && (
        <p className='text-sm text-destructive'>{errors._form[0]}</p>
      )}

      <div className='flex items-center justify-end gap-2 border-t border-border/60 pt-5'>
        <Button asChild variant='outline'>
          <Link href='/clients'>Cancel</Link>
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}
