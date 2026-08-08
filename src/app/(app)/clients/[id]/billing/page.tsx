import { notFound } from "next/navigation";
import type {
  BillingCycleStatus,
  InstallmentStatus,
  BillingEmailStatus,
} from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { SendInvoiceSheet } from "@/components/billing/send-invoice-sheet";
import {
  piastersFromDecimalString,
  piastersToDecimalString,
  splitFixedFeePiasters,
  sumPiasters,
} from "@/server/billing-math";
import { billingPeriodEndUtc } from "@/server/billing-invoice-send.logic";

// ============================================================================
// Client Billing (B-4 read-only view, extended in B-5B with "Send invoice").
//
// The page itself still WRITES NOTHING. It creates no BillingCycle, no
// installment, no payment and no email-delivery row, and it renders no
// document. The only mutation available from here is the explicit, confirmed
// "Send invoice" action, which runs entirely inside
// @/server/billing-invoice-send.
//
// MONEY: every amount is carried as integer piasters. Prisma Decimals are
// turned into exact strings with `.toString()` and parsed by the committed
// piaster helpers. No Number(), parseFloat(), toFixed(), or `.toNumber()` ever
// touches a billing figure — including for display, which is rendered straight
// from the exact decimal string.
//
// DATES: `@db.Date` columns are Africa/Cairo civil dates stored at UTC
// midnight, so they are formatted with UTC getters only. No local timezone can
// shift the displayed day, and no D+15 / D+14 is computed here — only stored
// dates are shown, and those only exist once a payment has been recorded.
// ============================================================================

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

// ---------------------------------------------------------------------------
// Exact money formatting — string-based, never floating point.
// ---------------------------------------------------------------------------

/** Group the integer part with thousands separators, by string only. */
function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** e.g. 1000001 piasters -> "EGP 10,000.01". No float involved. */
function formatPiasters(piasters: number, currency: string): string {
  const decimal = piastersToDecimalString(piasters);
  const [whole, fraction] = decimal.split(".");
  return `${currency} ${groupThousands(whole)}.${fraction}`;
}

/** Exact Prisma Decimal -> integer piasters. `.toString()` is lossless. */
function piastersFromDecimal(value: { toString(): string }): number {
  return piastersFromDecimalString(value.toString());
}

// ---------------------------------------------------------------------------
// Date formatting — UTC getters only (see header note).
// ---------------------------------------------------------------------------

function formatCivilDate(value: Date | null): string {
  if (value === null) return "—";
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Presentation vocabulary
// ---------------------------------------------------------------------------

type BadgeVariant =
  | "default"
  | "outline"
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "muted";

const CYCLE_STATUS_LABEL: Record<BillingCycleStatus, string> = {
  OPEN: "Open",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const CYCLE_STATUS_VARIANT: Record<BillingCycleStatus, BadgeVariant> = {
  OPEN: "info",
  PAID: "success",
  CANCELLED: "muted",
};

const FINANCIAL_STATUS_LABEL: Record<InstallmentStatus, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const FINANCIAL_STATUS_VARIANT: Record<InstallmentStatus, BadgeVariant> = {
  PENDING: "warning",
  PAID: "success",
  CANCELLED: "muted",
};

/**
 * Invoice presentation, derived ONLY from the INSTALLMENT_INVOICE delivery row
 * plus the installment's financial status.
 *
 * The installment's status is never mutated to represent invoice state — it
 * stays purely financial (PENDING / PAID / CANCELLED). "Awaiting payment" is a
 * derived view, not a stored one.
 */
function deriveInvoiceState(
  deliveryStatus: BillingEmailStatus | null,
  financialStatus: InstallmentStatus,
): { label: string; variant: BadgeVariant } {
  if (financialStatus === "CANCELLED") {
    return { label: "Cancelled", variant: "muted" };
  }
  if (deliveryStatus === null) {
    return { label: "Not invoiced", variant: "muted" };
  }
  switch (deliveryStatus) {
    case "PENDING":
      return { label: "Invoice pending", variant: "info" };
    case "SENDING":
      return { label: "Invoice sending", variant: "info" };
    case "FAILED":
      return { label: "Invoice failed", variant: "destructive" };
    case "SENT":
      return financialStatus === "PAID"
        ? { label: "Paid", variant: "success" }
        : { label: "Awaiting payment", variant: "warning" };
    default:
      return { label: "Not invoiced", variant: "muted" };
  }
}

/**
 * A SENDING delivery older than this is treated as a crashed send, matching the
 * reclaim window in @/server/billing-invoice-send. Display only — the authority
 * on whether a row may actually be claimed is the server's compare-and-swap.
 */
const STALE_SENDING_MS = 30 * 60 * 1000;

interface InstallmentActionProps {
  clientId: string;
  sequence: number;
  financialStatus: InstallmentStatus;
  delivery: {
    id: string;
    status: BillingEmailStatus;
    updatedAt: Date;
    recipient: string;
  } | null;
  /** Falls back to the client's current billing contact before a row exists. */
  recipient: string;
  amountLabel: string;
  servicePeriodLabel: string;
  dueDateLabel: string;
  nowMs: number;
}

/**
 * The invoice action for one installment row.
 *
 * Installment 2 never has one in this commit: its invoice is issued only after
 * installment 1 is paid, which is not implemented yet. Offering a button for it
 * would promise a flow that does not exist.
 */
function InstallmentAction({
  clientId,
  sequence,
  financialStatus,
  delivery,
  recipient,
  amountLabel,
  servicePeriodLabel,
  dueDateLabel,
  nowMs,
}: InstallmentActionProps) {
  const none = <span className='text-muted-foreground'>—</span>;

  if (sequence !== 1) return none;
  // Paid or cancelled installments are financially settled; re-invoicing them
  // is not a B-5B action.
  if (financialStatus !== "PENDING") return none;

  // No delivery row yet: this is the first send, so the bootstrap action runs.
  if (delivery === null) {
    return (
      <SendInvoiceSheet
        mode='send'
        clientId={clientId}
        triggerLabel='Send invoice'
        recipient={recipient}
        amountLabel={amountLabel}
        servicePeriodLabel={servicePeriodLabel}
        dueDateLabel={dueDateLabel}
      />
    );
  }

  if (delivery.status === "SENT") return none;

  if (
    delivery.status === "SENDING" &&
    nowMs - delivery.updatedAt.getTime() < STALE_SENDING_MS
  ) {
    // A live send owns this row. Offering Retry here would only produce an
    // IN_PROGRESS response.
    return <span className='text-xs text-muted-foreground'>Sending…</span>;
  }

  // PENDING (an unclaimed row left behind by a committed transaction whose send
  // never started), FAILED, or a SENDING row that has gone stale. All three are
  // re-sends of an invoice that already exists, so no number is allocated.
  return (
    <SendInvoiceSheet
      mode='retry'
      clientId={clientId}
      deliveryId={delivery.id}
      triggerLabel={
        delivery.status === "PENDING" ? "Send invoice" : "Retry invoice"
      }
      triggerVariant={delivery.status === "PENDING" ? "default" : "outline"}
      recipient={delivery.recipient}
      amountLabel={amountLabel}
      servicePeriodLabel={servicePeriodLabel}
      dueDateLabel={dueDateLabel}
    />
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className='pt-6'>
        <p className='text-xs uppercase tracking-wide text-muted-foreground'>
          {label}
        </p>
        <p className='mt-2 text-xl font-semibold tracking-tight'>{value}</p>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-4 py-2 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-medium text-foreground'>{value}</span>
    </div>
  );
}

export default async function ClientBillingPage({ params }: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      industry: true,
      billingEnabled: true,
      serviceFeeAmount: true,
      serviceFeeCurrency: true,
      billingContactName: true,
      billingContactEmail: true,
      billingCycleStartDate: true,
    },
  });
  if (!client) notFound();

  // Presentation only: how long a SENDING delivery has been quiet. No billing
  // date is ever derived from this — those all come from persisted @db.Date
  // values, which this page only reads.
  const nowMs = Date.now();

  const cycles = await db.billingCycle.findMany({
    where: { clientId: client.id },
    orderBy: { periodStart: "desc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      feeAmount: true,
      currency: true,
      status: true,
      installments: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          sharePercent: true,
          amountDue: true,
          currency: true,
          status: true,
          dueDate: true,
          reminderDate: true,
          paidAt: true,
          invoiceNumber: true,
          payment: {
            select: {
              id: true,
              amountReceived: true,
              currency: true,
              paymentDate: true,
              method: true,
              reference: true,
              receiptNumber: true,
            },
          },
          deliveries: {
            // `updatedAt` drives the stale-SENDING display only. `recipient`
            // is the address the invoice was actually addressed to, which a
            // later edit to the client's billing contact must not rewrite.
            select: {
              id: true,
              kind: true,
              status: true,
              updatedAt: true,
              recipient: true,
            },
          },
        },
      },
    },
  });

  const header = (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{client.name}</h1>
        {client.industry && (
          <p className='mt-1 text-sm text-muted-foreground'>
            {client.industry}
          </p>
        )}
      </div>
      <ClientSubNav clientId={client.id} active='billing' />
    </div>
  );

  const intro = (
    <div className='space-y-1'>
      <h2 className='text-xl font-semibold tracking-tight'>Billing</h2>
      <p className='text-sm text-muted-foreground'>
        Loopa&rsquo;s fixed monthly service fee — separate from the
        client&rsquo;s advertising budget.
      </p>
    </div>
  );

  // -------------------------------------------------------------------------
  // STATE A — billing not configured
  // -------------------------------------------------------------------------
  const profileComplete =
    client.billingEnabled &&
    client.serviceFeeAmount !== null &&
    client.serviceFeeCurrency !== null &&
    client.billingContactEmail !== null &&
    client.billingCycleStartDate !== null;

  if (!profileComplete) {
    return (
      <div className='space-y-8'>
        {header}
        {intro}
        <EmptyState
          title='Billing is not configured for this client.'
          description={
            "Commercial terms — the monthly service fee, billing contact, and billing cycle start date — are configured from Edit Client on the Clients page. Once they are saved, this tab shows the fixed 50% / 50% installment schedule."
          }
        />
      </div>
    );
  }

  // Past this point the profile is complete, so these are non-null.
  const feePiasters = piastersFromDecimal(client.serviceFeeAmount!);
  const currency = client.serviceFeeCurrency!;
  const contactLabel = client.billingContactName
    ? `${client.billingContactName} · ${client.billingContactEmail}`
    : (client.billingContactEmail as string);

  const configurationCard = (
    <Card>
      <CardHeader>
        <CardTitle>Fixed service fee</CardTitle>
      </CardHeader>
      <CardContent className='divide-y divide-border/60 pt-0'>
        <DetailRow
          label='Monthly service fee'
          value={formatPiasters(feePiasters, currency)}
        />
        <DetailRow label='Payment schedule' value='50% / 50% — two installments' />
        <DetailRow label='Billing contact' value={contactLabel} />
        <DetailRow
          label='Billing cycle start date'
          value={formatCivilDate(client.billingCycleStartDate)}
        />
      </CardContent>
    </Card>
  );

  // -------------------------------------------------------------------------
  // STATE B — configured, but no billing cycle exists yet
  // -------------------------------------------------------------------------
  if (cycles.length === 0) {
    const [firstPiasters, secondPiasters] = splitFixedFeePiasters(feePiasters);

    // Preview only. The authoritative period is recomputed from the same pure
    // helper inside the send transaction, from the same saved start date.
    const previewPeriodStart = client.billingCycleStartDate as Date;
    const previewPeriodLabel = `${formatCivilDate(previewPeriodStart)} → ${formatCivilDate(
      billingPeriodEndUtc(previewPeriodStart),
    )}`;

    return (
      <div className='space-y-8'>
        {header}
        {intro}
        {configurationCard}

        <Card>
          <CardHeader>
            <CardTitle>Installment preview</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4 pt-0'>
            <div className='rounded-md border border-border/60 p-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-sm font-medium text-foreground'>
                  Installment 1
                </span>
                <span className='text-sm font-semibold'>
                  {formatPiasters(firstPiasters, currency)}
                </span>
              </div>
              <p className='mt-2 text-xs text-muted-foreground'>
                Status:{" "}
                <Badge variant='info'>Ready to invoice</Badge>
              </p>
              <div className='mt-3'>
                <SendInvoiceSheet
                  mode='send'
                  clientId={client.id}
                  triggerLabel='Send invoice'
                  recipient={client.billingContactEmail as string}
                  amountLabel={formatPiasters(firstPiasters, currency)}
                  servicePeriodLabel={previewPeriodLabel}
                  dueDateLabel='Due on issue'
                />
              </div>
            </div>

            <div className='rounded-md border border-border/60 p-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-sm font-medium text-foreground'>
                  Installment 2
                </span>
                <span className='text-sm font-semibold'>
                  {formatPiasters(secondPiasters, currency)}
                </span>
              </div>
              <p className='mt-2 text-xs text-muted-foreground'>
                Timing: due 15 days after installment 1 is actually paid.
              </p>
            </div>

            <p className='rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground'>
              The 15-day clock starts when the first installment payment is
              recorded, not when the invoice is sent. Installment 2&rsquo;s
              calendar dates are therefore not calculated yet.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // STATE C — one or more billing cycles exist
  // -------------------------------------------------------------------------
  return (
    <div className='space-y-8'>
      {header}
      {intro}
      {configurationCard}

      {cycles.map((cycle) => {
        const cycleFeePiasters = piastersFromDecimal(cycle.feeAmount);
        const cyclePeriodLabel = `${formatCivilDate(cycle.periodStart)} → ${formatCivilDate(cycle.periodEnd)}`;

        // Received/outstanding are DERIVED from payment rows every render —
        // never stored, never cached, and summed in integer piasters.
        const paymentPiasters = cycle.installments
          .filter((i) => i.payment !== null)
          .map((i) => piastersFromDecimal(i.payment!.amountReceived));
        const receivedPiasters = sumPiasters(paymentPiasters);
        const outstandingPiasters = Math.max(
          0,
          cycleFeePiasters - receivedPiasters,
        );

        const payments = cycle.installments
          .filter((i) => i.payment !== null)
          .map((i) => ({ installmentSequence: i.sequence, ...i.payment! }))
          .sort(
            (a, b) => a.paymentDate.getTime() - b.paymentDate.getTime(),
          );

        return (
          <section key={cycle.id} className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 className='text-base font-semibold tracking-tight'>
                Billing period {formatCivilDate(cycle.periodStart)} →{" "}
                {formatCivilDate(cycle.periodEnd)}
              </h3>
              <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>
                {CYCLE_STATUS_LABEL[cycle.status]}
              </Badge>
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <SummaryCard
                label='Monthly service fee'
                value={formatPiasters(cycleFeePiasters, cycle.currency)}
              />
              <SummaryCard
                label='Amount received'
                value={formatPiasters(receivedPiasters, cycle.currency)}
              />
              <SummaryCard
                label='Outstanding'
                value={formatPiasters(outstandingPiasters, cycle.currency)}
              />
              <SummaryCard
                label='Cycle status'
                value={CYCLE_STATUS_LABEL[cycle.status]}
              />
            </div>

            {/* Installments */}
            <Card>
              <CardHeader>
                <CardTitle>Installments</CardTitle>
              </CardHeader>
              <CardContent className='pt-0'>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Installment</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Invoice no.</TableHead>
                        <TableHead>Invoice state</TableHead>
                        <TableHead>Financial status</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Reminder</TableHead>
                        <TableHead>Paid on</TableHead>
                        <TableHead>Receipt no.</TableHead>
                        <TableHead className='text-right'>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cycle.installments.map((installment) => {
                        const invoiceDelivery =
                          installment.deliveries.find(
                            (d) => d.kind === "INSTALLMENT_INVOICE",
                          ) ?? null;
                        const invoiceState = deriveInvoiceState(
                          invoiceDelivery ? invoiceDelivery.status : null,
                          installment.status,
                        );
                        return (
                          <TableRow key={installment.id}>
                            <TableCell className='font-medium'>
                              {installment.sequence} of 2
                              <span className='ml-2 text-xs text-muted-foreground'>
                                {installment.sharePercent}%
                              </span>
                            </TableCell>
                            <TableCell>
                              {formatPiasters(
                                piastersFromDecimal(installment.amountDue),
                                installment.currency,
                              )}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {installment.invoiceNumber ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={invoiceState.variant}>
                                {invoiceState.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  FINANCIAL_STATUS_VARIANT[installment.status]
                                }>
                                {FINANCIAL_STATUS_LABEL[installment.status]}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {formatCivilDate(installment.dueDate)}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {formatCivilDate(installment.reminderDate)}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {installment.payment
                                ? formatCivilDate(
                                    installment.payment.paymentDate,
                                  )
                                : "—"}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {installment.payment?.receiptNumber ?? "—"}
                            </TableCell>
                            <TableCell className='text-right'>
                              <InstallmentAction
                                clientId={client.id}
                                sequence={installment.sequence}
                                financialStatus={installment.status}
                                delivery={invoiceDelivery}
                                recipient={
                                  client.billingContactEmail as string
                                }
                                amountLabel={formatPiasters(
                                  piastersFromDecimal(installment.amountDue),
                                  installment.currency,
                                )}
                                servicePeriodLabel={cyclePeriodLabel}
                                dueDateLabel={
                                  installment.dueDate === null
                                    ? "Due on issue"
                                    : formatCivilDate(installment.dueDate)
                                }
                                nowMs={nowMs}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Keyed on installment 2 specifically. Once installment 1 has
                    been invoiced it HAS a due date, so an "every installment"
                    test would hide this note exactly when it matters most. */}
                {cycle.installments.some(
                  (i) => i.sequence === 2 && i.dueDate === null,
                ) && (
                  <p className='mt-4 text-xs text-muted-foreground'>
                    Installment 2 has no due date and no reminder date yet. Both
                    are set when the first installment payment is recorded — 15
                    and 14 days after the payment date.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Payment history */}
            <Card>
              <CardHeader>
                <CardTitle>Payment history</CardTitle>
              </CardHeader>
              <CardContent className='pt-0'>
                {payments.length === 0 ? (
                  <p className='rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground'>
                    No payments recorded for this billing period yet.
                  </p>
                ) : (
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Payment date</TableHead>
                          <TableHead>Installment</TableHead>
                          <TableHead>Amount received</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Receipt no.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className='font-medium'>
                              {formatCivilDate(payment.paymentDate)}
                            </TableCell>
                            <TableCell>
                              {payment.installmentSequence} of 2
                            </TableCell>
                            <TableCell>
                              {formatPiasters(
                                piastersFromDecimal(payment.amountReceived),
                                payment.currency,
                              )}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {payment.method.replace(/_/g, " ").toLowerCase()}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {payment.reference ?? "—"}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {payment.receiptNumber}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {cycle.status === "PAID" && (
              <div className='rounded-md border border-border/60 bg-muted/30 p-4 text-sm'>
                <p className='font-medium text-foreground'>
                  This billing cycle is complete.
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Automatic creation of the next monthly billing cycle is not
                  enabled yet.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
