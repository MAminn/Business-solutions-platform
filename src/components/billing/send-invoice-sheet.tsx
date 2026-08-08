"use client";

// ============================================================================
// "Send invoice" confirmation sheet.
//
// This is a CONFIRMATION step, not a form. Nothing here is editable: the
// amount, the dates, the invoice number and the recipient are authoritative
// server-side values, re-read inside the send transaction. The sheet only
// restates what is about to happen and asks for one deliberate click, because
// the next thing that happens is an email landing in a client's inbox.
//
// Sending installment 1 does NOT start installment 2's clock — that begins when
// the first payment is recorded — so the sheet says so explicitly rather than
// letting the user assume a second date now exists.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  sendFirstInstallmentInvoice,
  retryInstallmentInvoice,
  type SendInvoiceResult,
} from "@/server/billing-invoice-send";

type Feedback = { tone: "ok" | "warn" | "error"; text: string };

export interface SendInvoiceSheetProps {
  /** "send" bootstraps the cycle; "retry" only re-sends an existing delivery. */
  mode: "send" | "retry";
  clientId: string;
  /** Required when mode is "retry". */
  deliveryId?: string;
  /** Button label, e.g. "Send invoice" or "Retry invoice". */
  triggerLabel: string;
  triggerVariant?: "default" | "outline";
  triggerSize?: "default" | "sm";
  recipient: string;
  /** Pre-formatted, e.g. "EGP 5,000.00". Formatting stays with the caller. */
  amountLabel: string;
  /** Pre-formatted, e.g. "2026-08-07 → 2026-09-06". */
  servicePeriodLabel: string;
  /** "Due on issue" for a first send; the persisted day on a retry. */
  dueDateLabel: string;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-4 py-2 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right font-medium text-foreground'>{value}</span>
    </div>
  );
}

const FEEDBACK_CLASS: Record<Feedback["tone"], string> = {
  ok: "border-border/60 bg-muted/30 text-foreground",
  warn: "border-amber-500/40 bg-amber-500/10 text-foreground",
  error: "border-destructive/40 bg-destructive/10 text-foreground",
};

export function SendInvoiceSheet({
  mode,
  clientId,
  deliveryId,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "sm",
  recipient,
  amountLabel,
  servicePeriodLabel,
  dueDateLabel,
}: SendInvoiceSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(result: SendInvoiceResult): void {
    switch (result.status) {
      case "SENT":
        setOpen(false);
        setFeedback(null);
        router.refresh();
        return;
      case "ALREADY_SENT":
        setFeedback({ tone: "ok", text: result.message });
        router.refresh();
        return;
      case "IN_PROGRESS":
        setFeedback({ tone: "warn", text: result.message });
        router.refresh();
        return;
      case "DELIVERY_FAILED":
        // The invoice itself exists and is numbered — only the email failed.
        setFeedback({ tone: "error", text: result.message });
        router.refresh();
        return;
      case "BLOCKED":
        setFeedback({ tone: "error", text: result.message });
        return;
    }
  }

  function confirm(): void {
    setFeedback(null);
    startTransition(async () => {
      const result =
        mode === "retry" && deliveryId
          ? await retryInstallmentInvoice(deliveryId)
          : await sendFirstInstallmentInvoice(clientId);
      apply(result);
    });
  }

  return (
    <>
      <Button
        type='button'
        size={triggerSize}
        variant={triggerVariant}
        onClick={() => {
          setFeedback(null);
          setOpen(true);
        }}>
        {triggerLabel}
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          // Never let the sheet close out from under an in-flight send.
          if (pending) return;
          setOpen(next);
        }}>
        <SheetContent className='gap-0 overflow-y-auto p-6'>
          <SheetTitle>
            {mode === "retry" ? "Retry invoice email" : "Send invoice"}
          </SheetTitle>
          <SheetDescription className='mt-1'>
            {mode === "retry"
              ? "Re-sends the same invoice, with the same number, to the same recipient."
              : "This emails the first installment invoice to the client's billing contact."}
          </SheetDescription>

          <div className='mt-6 divide-y divide-border/60 rounded-md border border-border/60 px-4'>
            <SummaryRow label='Recipient' value={recipient} />
            <SummaryRow label='Installment' value='1 of 2 · 50%' />
            <SummaryRow label='Amount' value={amountLabel} />
            <SummaryRow label='Service period' value={servicePeriodLabel} />
            <SummaryRow label='Due date' value={dueDateLabel} />
          </div>

          <p className='mt-4 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground'>
            The second installment date is not calculated until this payment is
            recorded.
          </p>

          {feedback && (
            <p
              className={`mt-4 rounded-md border p-3 text-sm ${FEEDBACK_CLASS[feedback.tone]}`}
              role='status'>
              {feedback.text}
            </p>
          )}

          <div className='mt-6 flex items-center justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={pending}
              onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type='button' disabled={pending} onClick={confirm}>
              {pending ? "Sending…" : "Send invoice"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
