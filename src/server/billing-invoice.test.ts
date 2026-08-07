import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertValidInvoiceInput,
  formatInvoiceAmount,
  installmentLabel,
  installmentLabelWithShare,
  servicePeriodLabel,
  invoiceFileName,
  buildInvoiceEmailSubject,
  buildInvoiceEmailHtml,
  buildInvoiceEmailText,
  SERVICE_DESCRIPTION,
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
// Exact EGP formatting — integer piasters only
// ---------------------------------------------------------------------------

test("formats exact EGP amounts from integer piasters", () => {
  assert.equal(formatInvoiceAmount(500000, "EGP"), "EGP 5,000.00");
  assert.equal(formatInvoiceAmount(500001, "EGP"), "EGP 5,000.01");
  assert.equal(formatInvoiceAmount(1000001, "EGP"), "EGP 10,000.01");
  assert.equal(formatInvoiceAmount(5, "EGP"), "EGP 0.05");
  assert.equal(formatInvoiceAmount(0, "EGP"), "EGP 0.00");
  assert.equal(formatInvoiceAmount(100000000, "EGP"), "EGP 1,000,000.00");
});

test("the 50/50 split of an odd fee formats exactly, with no lost piaster", () => {
  // EGP 10,000.01 -> 5,000.01 + 5,000.00
  assert.equal(formatInvoiceAmount(500001, "EGP"), "EGP 5,000.01");
  assert.equal(formatInvoiceAmount(500000, "EGP"), "EGP 5,000.00");
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("installment labels", () => {
  assert.equal(installmentLabel(1, 2), "Installment 1 of 2");
  assert.equal(installmentLabel(2, 2), "Installment 2 of 2");
  assert.equal(installmentLabelWithShare(invoice()), "Installment 1 of 2 · 50%");
});

test("service period label uses an ASCII separator the PDF font can render", () => {
  assert.equal(servicePeriodLabel(invoice()), "2026-08-07 to 2026-09-06");
  // The Noto Sans Arabic subset embedded in the PDF has no glyph for these.
  assert.ok(!servicePeriodLabel(invoice()).includes("→"));
  assert.ok(!servicePeriodLabel(invoice()).includes("–"));
});

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

test("subject is transactional and carries amount and client", () => {
  assert.equal(
    buildInvoiceEmailSubject(invoice()),
    "Loopa service fee invoice · EGP 5,000.00 · Mach",
  );
});

test("subject is plain text and never HTML-escaped", () => {
  const subject = buildInvoiceEmailSubject(invoice({ clientName: `Mach & Co` }));
  assert.ok(subject.includes("Mach & Co"));
  assert.ok(!subject.includes("&amp;"));
});

// ---------------------------------------------------------------------------
// Filename safety
// ---------------------------------------------------------------------------

test("invoice filename is safe and derived only from the invoice number", () => {
  assert.equal(
    invoiceFileName(invoice()),
    "loopa-service-fee-invoice-LG-INV-2026-0001.pdf",
  );
});

test("invoice filename cannot be influenced by the client name", () => {
  const name = invoiceFileName(
    invoice({ clientName: `../../etc/passwd <script>` }),
  );
  assert.equal(name, "loopa-service-fee-invoice-LG-INV-2026-0001.pdf");
  assert.ok(!name.includes("/"));
  assert.ok(!name.includes(".."));
});

test("a path-traversal invoice number is rejected outright", () => {
  assert.throws(
    () => invoiceFileName(invoice({ invoiceNumber: "../../etc/passwd" })),
    /Invalid invoiceNumber/,
  );
});

// ---------------------------------------------------------------------------
// Email content
// ---------------------------------------------------------------------------

test("email body contains every required invoice fact", () => {
  const html = buildInvoiceEmailHtml(invoice());
  for (const expected of [
    "Mach",
    "LG-INV-2026-0001",
    "2026-08-07 to 2026-09-06",
    "Installment 1 of 2",
    "50%",
    "EGP 5,000.00",
    SERVICE_DESCRIPTION,
  ]) {
    assert.ok(html.includes(expected), `email must contain ${expected}`);
  }
  assert.ok(/attach/i.test(html), "must mention the attachment");
});

test("plain-text body carries the same facts", () => {
  const text = buildInvoiceEmailText(invoice());
  for (const expected of [
    "Mach",
    "LG-INV-2026-0001",
    "2026-08-07 to 2026-09-06",
    "Installment 1 of 2 · 50%",
    "EGP 5,000.00",
  ]) {
    assert.ok(text.includes(expected), `text must contain ${expected}`);
  }
  assert.ok(!text.includes("<"), "plain text must contain no markup");
});

test("greets the billing contact when present, the client otherwise", () => {
  assert.ok(buildInvoiceEmailText(invoice()).includes("Hello Nour Hassan,"));
  assert.ok(
    buildInvoiceEmailText(invoice({ billingContactName: null })).includes(
      "Hello Mach,",
    ),
  );
});

test("invents no payment instructions, links, or bank details", () => {
  const html = buildInvoiceEmailHtml(invoice());
  const text = buildInvoiceEmailText(invoice());
  for (const body of [html, text]) {
    assert.ok(!/iban/i.test(body), "no IBAN");
    assert.ok(!/swift/i.test(body), "no SWIFT");
    assert.ok(!/bank account/i.test(body), "no bank account details");
    assert.ok(!/pay now|click here/i.test(body), "no payment link CTA");
  }
  assert.ok(!/https?:\/\//.test(html), "no URLs in the invoice email");
});

test("never claims to be a tax or VAT invoice", () => {
  const html = buildInvoiceEmailHtml(invoice());
  assert.ok(!/tax invoice/i.test(html));
  assert.ok(!/vat/i.test(html));
});

// ---------------------------------------------------------------------------
// The first installment must not invent a second-installment date
// ---------------------------------------------------------------------------

test("installment 1 email does not mention a second installment or a 15-day clock", () => {
  const html = buildInvoiceEmailHtml(invoice({ installmentSequence: 1 }));
  const text = buildInvoiceEmailText(invoice({ installmentSequence: 1 }));
  for (const body of [html, text]) {
    assert.ok(!/15 day|15 calendar|second installment/i.test(body));
    assert.ok(!/installment 2/i.test(body));
  }
});

test("installment 2 renders the supplied due date without computing it", () => {
  const html = buildInvoiceEmailHtml(
    invoice({
      installmentSequence: 2,
      dueDate: "2026-08-22",
      amountPiasters: 500000,
    }),
  );
  assert.ok(html.includes("Installment 2 of 2"));
  assert.ok(html.includes("2026-08-22"));
});

// ---------------------------------------------------------------------------
// HTML escaping of hostile values
// ---------------------------------------------------------------------------

test("hostile client name is escaped, never executable markup", () => {
  const html = buildInvoiceEmailHtml(invoice({ clientName: `<Mach & "Co">` }));
  assert.ok(
    html.includes("&lt;Mach &amp; &quot;Co&quot;&gt;"),
    "must appear as escaped text",
  );
  assert.ok(!html.includes(`<Mach`), "raw markup must not survive");
});

test("a script tag in a client-controlled field cannot execute", () => {
  const html = buildInvoiceEmailHtml(
    invoice({
      clientName: `<script>alert('x')</script>`,
      billingContactName: `<img src=x onerror=alert(1)>`,
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("accepts a valid invoice", () => {
  assert.doesNotThrow(() => assertValidInvoiceInput(invoice()));
});

test("rejects malformed invoice numbers", () => {
  for (const bad of ["", "has space", "semi;colon", "a/b", "../x"]) {
    assert.throws(
      () => assertValidInvoiceInput(invoice({ invoiceNumber: bad })),
      /Invalid invoiceNumber/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("rejects an empty client name", () => {
  assert.throws(
    () => assertValidInvoiceInput(invoice({ clientName: "   " })),
    /clientName is required/,
  );
});

test("rejects malformed and impossible dates", () => {
  for (const bad of ["2026-8-7", "07/08/2026", "2026-02-30", "2026-13-01", ""]) {
    assert.throws(
      () => assertValidInvoiceInput(invoice({ invoiceDate: bad })),
      /invoiceDate must be a real YYYY-MM-DD date/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
  assert.throws(
    () => assertValidInvoiceInput(invoice({ dueDate: "2027-02-29" })),
    /dueDate must be a real YYYY-MM-DD date/,
  );
});

test("rejects a service period that ends before it starts", () => {
  assert.throws(
    () =>
      assertValidInvoiceInput(
        invoice({
          servicePeriodStart: "2026-09-06",
          servicePeriodEnd: "2026-08-07",
        }),
      ),
    /servicePeriodEnd must not precede servicePeriodStart/,
  );
});

test("rejects out-of-scope installment shapes", () => {
  assert.throws(
    () =>
      assertValidInvoiceInput(
        invoice({ installmentSequence: 3 as unknown as 1 }),
      ),
    /installmentSequence must be 1 or 2/,
  );
  assert.throws(
    () =>
      assertValidInvoiceInput(invoice({ installmentCount: 3 as unknown as 2 })),
    /installmentCount must be 2/,
  );
  assert.throws(
    () => assertValidInvoiceInput(invoice({ sharePercent: 60 })),
    /sharePercent must be 50/,
  );
});

test("rejects invalid money", () => {
  for (const bad of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(
      () => assertValidInvoiceInput(invoice({ amountPiasters: bad })),
      /amountPiasters must be a non-negative safe integer/,
      `expected ${bad} to be rejected`,
    );
  }
});

test("rejects a non-EGP currency", () => {
  assert.throws(
    () => assertValidInvoiceInput(invoice({ currency: "USD" as "EGP" })),
    /currency must be EGP/,
  );
});

test("builders are deterministic for identical input", () => {
  assert.equal(buildInvoiceEmailHtml(invoice()), buildInvoiceEmailHtml(invoice()));
  assert.equal(buildInvoiceEmailText(invoice()), buildInvoiceEmailText(invoice()));
  assert.equal(
    buildInvoiceEmailSubject(invoice()),
    buildInvoiceEmailSubject(invoice()),
  );
});
