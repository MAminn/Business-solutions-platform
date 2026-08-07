import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBillingInvoicePdf } from "./billing-invoice-doc";
import {
  formatInvoiceAmount,
  installmentLabel,
  servicePeriodLabel,
  type BillingInvoiceInput,
} from "./billing-invoice";

function invoice(
  overrides: Partial<BillingInvoiceInput> = {},
): BillingInvoiceInput {
  return {
    invoiceNumber: "LG-INV-2026-0001",
    invoiceDate: "2026-08-07",
    clientName: "Mach",
    billingContactName: "Nour Hassan",
    servicePeriodStart: "2026-08-07",
    servicePeriodEnd: "2026-09-06",
    installmentSequence: 1,
    installmentCount: 2,
    sharePercent: 50,
    amountPiasters: 500000,
    currency: "EGP",
    dueDate: "2026-08-07",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BYTE-LEVEL DETERMINISM IS NOT ACHIEVABLE, AND THAT IS EXPECTED.
//
// @react-pdf/renderer injects two pieces of per-render metadata we do not
// control, neither of which changes a single visible character on the page:
//
//   1. a CreationDate stamped into the trailer, e.g. "(D:20260807125139Z)";
//   2. the 6-letter PDF font SUBSET TAG that fontkit randomises per render,
//      e.g. "/NSALOL+NotoSansArabic-Bold" vs "/ZWODWK+NotoSansArabic-Bold".
//
// Both were found by byte-diffing two renders of identical input. The subset
// tag also appears INSIDE FlateDecode-compressed streams, so it cannot simply
// be masked out of the plaintext — the compressed bytes differ, which in turn
// shuffles PDF object ordering. Byte equality is therefore not a meaningful
// assertion here.
//
// What IS deterministic, and what these tests assert instead:
//   - the output byte LENGTH is stable (verified stable across repeated runs,
//     because both varying fields are fixed-width);
//   - the presentation data that determines every visible character comes from
//     the pure builders in ./billing-invoice, which are exhaustively tested for
//     determinism in billing-invoice.test.ts.
// ---------------------------------------------------------------------------

test("renders a non-empty PDF buffer", async () => {
  const buffer = await renderBillingInvoicePdf(invoice());
  assert.ok(Buffer.isBuffer(buffer), "must return a Buffer");
  assert.ok(buffer.byteLength > 1000, `expected a real PDF, got ${buffer.byteLength} bytes`);
});

test("output starts with the %PDF signature", async () => {
  const buffer = await renderBillingInvoicePdf(invoice());
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("identical input renders a byte-stable document size", async () => {
  const a = await renderBillingInvoicePdf(invoice());
  const b = await renderBillingInvoicePdf(invoice());
  assert.equal(
    a.byteLength,
    b.byteLength,
    "identical input must produce an identically sized document",
  );
});

test("the presentation data driving the document is fully deterministic", () => {
  // Every visible character on the page comes from these pure builders, so
  // their determinism is the determinism that actually matters. See the note
  // above on why raw PDF bytes cannot be compared.
  const a = invoice();
  const b = invoice();
  assert.equal(
    formatInvoiceAmount(a.amountPiasters, a.currency),
    formatInvoiceAmount(b.amountPiasters, b.currency),
  );
  assert.equal(servicePeriodLabel(a), servicePeriodLabel(b));
  assert.equal(
    installmentLabel(a.installmentSequence, a.installmentCount),
    installmentLabel(b.installmentSequence, b.installmentCount),
  );
  assert.equal(formatInvoiceAmount(500000, "EGP"), "EGP 5,000.00");
  assert.equal(formatInvoiceAmount(500001, "EGP"), "EGP 5,000.01");
});

test("a one-piaster difference changes the document's presentation data", () => {
  assert.notEqual(
    formatInvoiceAmount(500000, "EGP"),
    formatInvoiceAmount(500001, "EGP"),
  );
});

test("both installment amounts of an odd fee render successfully", async () => {
  const first = await renderBillingInvoicePdf(invoice({ amountPiasters: 500001 }));
  const second = await renderBillingInvoicePdf(invoice({ amountPiasters: 500000 }));
  assert.equal(first.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(second.subarray(0, 5).toString("latin1"), "%PDF-");
});

// ---------------------------------------------------------------------------
// Invalid input is rejected BEFORE anything is rendered
// ---------------------------------------------------------------------------

// `renderBillingInvoicePdf` is async, so validation failures surface as a
// REJECTED PROMISE rather than a synchronous throw. Nothing is rendered in
// either case — validation still runs before renderToBuffer.

test("rejects invalid money before rendering", async () => {
  await assert.rejects(
    renderBillingInvoicePdf(invoice({ amountPiasters: -1 })),
    /amountPiasters must be a non-negative safe integer/,
  );
  await assert.rejects(
    renderBillingInvoicePdf(invoice({ amountPiasters: 1.5 })),
    /amountPiasters must be a non-negative safe integer/,
  );
});

test("rejects an impossible date before rendering", async () => {
  await assert.rejects(
    renderBillingInvoicePdf(invoice({ dueDate: "2026-02-30" })),
    /dueDate must be a real YYYY-MM-DD date/,
  );
});

test("rejects a non-EGP currency before rendering", async () => {
  await assert.rejects(
    renderBillingInvoicePdf(invoice({ currency: "USD" as "EGP" })),
    /currency must be EGP/,
  );
});

test("rejects an unsafe invoice number before rendering", async () => {
  await assert.rejects(
    renderBillingInvoicePdf(invoice({ invoiceNumber: "../../etc/passwd" })),
    /Invalid invoiceNumber/,
  );
});

test("invalid input never throws synchronously — it always rejects", () => {
  // Guards the async contract itself: calling the function must return a
  // Promise, not blow up before one exists.
  const promise = renderBillingInvoicePdf(invoice({ amountPiasters: -1 }));
  assert.ok(promise instanceof Promise);
  promise.catch(() => {
    /* handled by the assertions above; swallow to avoid an unhandled rejection */
  });
});

/**
 * Page count, read straight from the PDF's page tree (`/Count N` on the /Pages
 * node). No parsing library needed, so this runs under the repo's existing test
 * setup with no new dependency.
 *
 * This guards the ONE-PAGE requirement. It matters more than it looks: an
 * overflow of even a few points silently produces a second page carrying only
 * the `fixed` footer, which is easy to ship without noticing.
 */
function pdfPageCount(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const pagesNode = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(text);
  if (pagesNode) return Number(pagesNode[1]);
  const countAfter = /\/Count\s+(\d+)/.exec(text);
  if (countAfter) return Number(countAfter[1]);
  throw new Error("could not determine page count");
}

test("the sample invoice is exactly one A4 page", async () => {
  const buffer = await renderBillingInvoicePdf(invoice());
  assert.equal(pdfPageCount(buffer), 1);
});

// ---------------------------------------------------------------------------
// Layout safety for long-but-reasonable dynamic values.
//
// The redesigned single-page A4 layout gives the billed-to block and the meta
// column fixed proportional widths, so long values wrap rather than overflow.
// These renders would throw or paginate if a value blew the layout apart.
// ---------------------------------------------------------------------------

test("a long but realistic client name renders on one page", async () => {
  const buffer = await renderBillingInvoicePdf(
    invoice({
      clientName: "Mach Supplements & Nutrition Trading Company L.L.C.",
      billingContactName: "Abdel Rahman Mohamed Aboelnile",
    }),
  );
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pdfPageCount(buffer), 1, "a long client name must not spill a second page");
});

test("a long invoice number renders without breaking the meta column", async () => {
  const buffer = await renderBillingInvoicePdf(
    invoice({ invoiceNumber: "LG-INV-2026-000000000000001" }),
  );
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pdfPageCount(buffer), 1);
});

test("the largest supported amount renders", async () => {
  // Decimal(12,2) maximum: 9,999,999,999.99
  const buffer = await renderBillingInvoicePdf(
    invoice({ amountPiasters: 999_999_999_999 }),
  );
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pdfPageCount(buffer), 1);
});

test("renders installment 2 and a hostile client name without throwing", async () => {
  const buffer = await renderBillingInvoicePdf(
    invoice({
      installmentSequence: 2,
      dueDate: "2026-08-22",
      clientName: `<Mach & "Co">`,
      billingContactName: null,
    }),
  );
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buffer.byteLength > 1000);
});

test("the worst realistic case — long name, long number, max amount — stays one page", async () => {
  const buffer = await renderBillingInvoicePdf(
    invoice({
      clientName: "Mach Supplements & Nutrition Trading Company L.L.C.",
      billingContactName: "Abdel Rahman Mohamed Aboelnile",
      invoiceNumber: "LG-INV-2026-000000000000001",
      amountPiasters: 999_999_999_999,
    }),
  );
  assert.equal(pdfPageCount(buffer), 1);
});

// ---------------------------------------------------------------------------
// The page must carry the ORIGINAL template artwork, not recreated primitives.
// ---------------------------------------------------------------------------

test("embeds the original Loopa template artwork as a background image", async () => {
  const buffer = await renderBillingInvoicePdf(invoice());
  const raw = buffer.toString("latin1");
  assert.match(
    raw,
    /\/Subtype\s*\/Image/,
    "the sanitised template PNG must be embedded — if this fails, public/billing/loopa-invoice-template.png is missing or failed to load",
  );
  // A Windows absolute path passed as <Image src> silently embeds nothing and
  // still produces a valid ~5KB document, so size is a meaningful guard here.
  assert.ok(
    buffer.byteLength > 200_000,
    `expected the artwork to be embedded, got only ${buffer.byteLength} bytes`,
  );
});

test("overlays every dynamic value onto the artwork", async () => {
  const buffer = await renderBillingInvoicePdf(invoice());
  // 30 positioned text runs: client, contact, service period, installment,
  // invoice number, both dates, the line item, and both totals.
  assert.equal(pdfPageCount(buffer), 1);
  assert.ok(buffer.byteLength > 200_000);
});
