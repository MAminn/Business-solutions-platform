"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SUPPORTED_CURRENCIES, COMMON_TIMEZONES } from "@/lib/locale";
import { createClient } from "@/server/clients";
import type { ClientFormState } from "@/server/clients.schemas";

const initialState: ClientFormState = {};

interface FieldProps {
  id: string;
  label: string;
  name: string;
  type?: "text" | "number" | "url";
  step?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
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
  hint,
  errors,
}: FieldProps) {
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
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
        aria-describedby={errorId ?? hintId}
      />
      {hint && !errorId && (
        <p id={hintId} className='text-xs text-muted-foreground'>
          {hint}
        </p>
      )}
      {errors && errors.length > 0 && (
        <p id={errorId} className='text-xs text-destructive'>
          {errors[0]}
        </p>
      )}
    </div>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  name: string;
  options: readonly string[];
  placeholder: string;
  errors?: string[];
}

function SelectField({
  id,
  label,
  name,
  options,
  placeholder,
  errors,
}: SelectFieldProps) {
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue=''
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}>
        <option value=''>{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {errors && errors.length > 0 && (
        <p id={errorId} className='text-xs text-destructive'>
          {errors[0]}
        </p>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className='border-b border-border/60 pb-2'>
      <h3 className='text-sm font-semibold tracking-tight'>{title}</h3>
      {subtitle && (
        <p className='mt-1 text-xs text-muted-foreground'>{subtitle}</p>
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
    <form action={formAction} className='space-y-8'>
      {/* Section A — Client */}
      <section className='space-y-4'>
        <SectionHeader title='Client' />
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
          <Field
            id='client-industry'
            label='Industry'
            name='industry'
            placeholder='e.g. Beauty / DTC'
            errors={errors.industry}
          />
          <Field
            id='client-logo-url'
            label='Logo URL'
            name='logoUrl'
            type='url'
            placeholder='https://… (paste image URL for now)'
            errors={errors.logoUrl}
          />
        </div>
      </section>

      {/* Section B — KPI targets */}
      <section className='space-y-4'>
        <SectionHeader
          title='KPI targets'
          subtitle='All optional. Used by alerts.'
        />
        <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
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
            id='client-min-cpa'
            label='Ideal CPA target'
            name='minCpa'
            type='number'
            step='0.01'
            placeholder='0'
            errors={errors.minCpa}
          />
          <Field
            id='client-max-cpa'
            label='Alert if CPA exceeds'
            name='maxCpa'
            type='number'
            step='0.01'
            placeholder='0'
            errors={errors.maxCpa}
          />
          <Field
            id='client-min-roas'
            label='Alert if ROAS drops below'
            name='minRoas'
            type='number'
            step='0.01'
            placeholder='0.00'
            errors={errors.minRoas}
          />
        </div>
      </section>

      {/* Section C — Meta ad account */}
      <section className='space-y-4'>
        <SectionHeader
          title='Meta ad account'
          subtitle='Optional. You can attach this later from Settings → Integrations. OAuth is handled there — never paste tokens here.'
        />
        <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
          <Field
            id='client-meta-id'
            label='Meta ad account ID'
            name='metaAdAccountId'
            placeholder='act_123456789012345'
            errors={errors.metaAdAccountId}
          />
          <Field
            id='client-meta-name'
            label='Meta account name'
            name='metaAccountName'
            placeholder='e.g. Lumen — Main'
            errors={errors.metaAccountName}
          />
          <SelectField
            id='client-currency'
            label='Currency'
            name='currency'
            options={SUPPORTED_CURRENCIES}
            placeholder='Select currency…'
            errors={errors.currency}
          />
          <SelectField
            id='client-timezone'
            label='Timezone'
            name='timezone'
            options={COMMON_TIMEZONES}
            placeholder='Select timezone…'
            errors={errors.timezone}
          />
        </div>
      </section>

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
