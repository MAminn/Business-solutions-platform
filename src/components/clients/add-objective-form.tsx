"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { CampaignObjectiveType } from "@prisma/client";
import { addObjective } from "@/server/strategy";
import { OBJECTIVE_LABEL } from "@/lib/meta/objectives";
import type { StrategyFormState } from "@/server/strategy.schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: StrategyFormState = {};

async function addObjectiveAction(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  const strategyId = String(formData.get("strategyId") ?? "");
  const type = String(formData.get("type") ?? "") as CampaignObjectiveType;
  const allocatedBudget = String(formData.get("allocatedBudget") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const result = await addObjective({
    strategyId,
    type,
    allocatedBudget,
    notes,
  });
  if ("ok" in result) return { message: "Objective added" };
  return result;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type='submit' size='sm' disabled={pending}>
      {pending ? "Adding…" : "Add objective"}
    </Button>
  );
}

interface AddObjectiveFormProps {
  strategyId: string;
  availableTypes: CampaignObjectiveType[];
}

export function AddObjectiveForm({
  strategyId,
  availableTypes,
}: AddObjectiveFormProps) {
  const [state, formAction] = useFormState(addObjectiveAction, initialState);
  const types =
    availableTypes.length > 0
      ? availableTypes
      : (Object.keys(OBJECTIVE_LABEL) as CampaignObjectiveType[]);

  return (
    <form action={formAction} className='space-y-4'>
      <input type='hidden' name='strategyId' value={strategyId} />
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='obj-type'>Objective</Label>
          <select
            id='obj-type'
            name='type'
            required
            defaultValue={types[0]}
            className='flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring'>
            {types.map((t) => (
              <option key={t} value={t}>
                {OBJECTIVE_LABEL[t]}
              </option>
            ))}
          </select>
          {state.errors?.type && (
            <p className='text-xs text-destructive'>{state.errors.type[0]}</p>
          )}
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor='obj-budget'>Allocated budget</Label>
          <Input
            id='obj-budget'
            name='allocatedBudget'
            type='number'
            min='0'
            step='0.01'
            required
          />
          {state.errors?.allocatedBudget && (
            <p className='text-xs text-destructive'>
              {state.errors.allocatedBudget[0]}
            </p>
          )}
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor='obj-notes'>Notes (optional)</Label>
          <Input id='obj-notes' name='notes' type='text' maxLength={1000} />
          {state.errors?.notes && (
            <p className='text-xs text-destructive'>{state.errors.notes[0]}</p>
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
