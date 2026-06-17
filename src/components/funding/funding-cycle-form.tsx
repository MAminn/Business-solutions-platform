"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  createFundingCycle,
  type FundingFormState,
} from "@/server/funding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: FundingFormState = {};

interface FundingCycleFormProps {
  adAccountConnectionId: string;
  currency: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type='submit' size='sm' disabled={pending}>
      {pending ? "Logging…" : "Log fund / top-up"}
    </Button>
  );
}

export function FundingCycleForm({
  adAccountConnectionId,
  currency,
}: FundingCycleFormProps) {
  async function action(
    _prev: FundingFormState,
    formData: FormData,
  ): Promise<FundingFormState> {
    return createFundingCycle({
      adAccountConnectionId: String(formData.get("adAccountConnectionId") ?? ""),
      amount: Number(formData.get("amount") ?? 0),
      note: String(formData.get("note") ?? ""),
    });
  }

  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className='space-y-3'>
      <input
        type='hidden'
        name='adAccountConnectionId'
        value={adAccountConnectionId}
      />
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label htmlFor={`fund-amount-${adAccountConnectionId}`}>Amount</Label>
          <Input
            id={`fund-amount-${adAccountConnectionId}`}
            name='amount'
            type='number'
            min='0'
            step='0.01'
            required
          />
          {state.errors?.amount && (
            <p className='text-xs text-destructive'>{state.errors.amount[0]}</p>
          )}
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor={`fund-currency-${adAccountConnectionId}`}>
            Currency
          </Label>
          <Input
            id={`fund-currency-${adAccountConnectionId}`}
            value={currency}
            readOnly
            disabled
          />
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor={`fund-note-${adAccountConnectionId}`}>
            Note (optional)
          </Label>
          <Input
            id={`fund-note-${adAccountConnectionId}`}
            name='note'
            type='text'
            maxLength={1000}
          />
          {state.errors?.note && (
            <p className='text-xs text-destructive'>{state.errors.note[0]}</p>
          )}
        </div>
      </div>

      {state.errors?._form && (
        <p className='text-xs text-destructive'>{state.errors._form[0]}</p>
      )}
      {state.message && (
        <p className='text-xs text-emerald-400'>{state.message}</p>
      )}

      <SubmitButton />
    </form>
  );
}
