import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceImageCid,
  invoiceImageFileName,
  buildInvoiceInlineEmailHtml,
} from "./billing-invoice-email-inline";
import type { BillingInvoiceInput } from "./billing-invoice";

const BASE: BillingInvoiceInput = {
  invoiceNumber: "LG-INV-2026-0001",
  invoiceDate: "2026-08-07",
  dueDate: "2026-08-07",
  clientName: "Mach",
  billingContactName: "Omar Khaled",
  servicePeriodStart: "2026-08-07",
  servicePeriodEnd: "2026-09-06",
  installmentSequence: 1,
  installmentCount: 2,
  sharePercent: 50,
  amountPiasters: 500_000,
  currency: "EGP",
};

function withInput(patch: Partial<BillingInvoiceInput>): BillingInvoiceInput {
  return { ...BASE, ...patch };
}

// ---------------------------------------------------------------------------
// Content-ID
// ---------------------------------------------------------------------------

test("invoiceImageCid: derived from the invoice number", () => {
  assert.equal(invoiceImageCid(BASE), "invoice-LG-INV-2026-0001@loopa.invoice");
});

test("invoiceImageCid: deterministic across calls", () => {
  assert.equal(invoiceImageCid(BASE), invoiceImageCid({ ...BASE }));
});

test("invoiceImageCid: tracks the invoice number", () => {
  assert.equal(
    invoiceImageCid(withInput({ invoiceNumber: "LG-INV-2027-0042" })),
    "invoice-LG-INV-2027-0042@loopa.invoice",
  );
});

test("invoiceImageCid: contains no character that could break a MIME header", () => {
  const cid = invoiceImageCid(BASE);
  for (const bad of ['"', "'", "<", ">", " ", "\t", "\n", "\r", ";", ","]) {
    assert.ok(!cid.includes(bad), `CID must not contain ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

test("invoiceImageFileName: deterministic PNG name from the invoice number", () => {
  assert.equal(
    invoiceImageFileName(BASE),
    "loopa-service-fee-invoice-LG-INV-2026-0001.png",
  );
});

test("invoiceImageFileName: always a .png, never a .pdf", () => {
  const name = invoiceImageFileName(BASE);
  assert.ok(name.endsWith(".png"));
  assert.ok(!name.endsWith(".pdf"));
});

// ---------------------------------------------------------------------------
// HTML: the image, and only the image
// ---------------------------------------------------------------------------

test("buildInvoiceInlineEmailHtml: references exactly the generated CID", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  const cid = invoiceImageCid(BASE);

  assert.ok(html.includes(`src="cid:${cid}"`));
  // Exactly one cid: reference — no stray or stale second image.
  assert.equal(html.split("cid:").length - 1, 1);
  assert.equal(html.split("<img").length - 1, 1);
});

test("buildInvoiceInlineEmailHtml: fixed width attribute for Outlook", () => {
  assert.ok(buildInvoiceInlineEmailHtml(BASE).includes('width="600"'));
});

test("buildInvoiceInlineEmailHtml: responsive max-width for mobile", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  assert.ok(html.includes("max-width:600px"));
  assert.ok(html.includes("width:100%"));
  assert.ok(html.includes("height:auto"));
});

test("buildInvoiceInlineEmailHtml: alt text carries invoice number, amount and due date", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  const alt = /alt="([^"]*)"/.exec(html)?.[1];
  assert.ok(alt, "an alt attribute must be present");
  assert.ok(alt!.includes("LG-INV-2026-0001"), "alt must name the invoice");
  assert.ok(alt!.includes("EGP 5,000.00"), "alt must state the amount");
  assert.ok(alt!.includes("2026-08-07"), "alt must state the due date");
});

test("buildInvoiceInlineEmailHtml: alt text reflects the exact amount, including an odd piaster", () => {
  const html = buildInvoiceInlineEmailHtml(
    withInput({ amountPiasters: 500_001 }),
  );
  assert.ok(html.includes("EGP 5,000.01"));
});

test("buildInvoiceInlineEmailHtml: deterministic for identical input", () => {
  assert.equal(
    buildInvoiceInlineEmailHtml(BASE),
    buildInvoiceInlineEmailHtml({ ...BASE }),
  );
});

// ---------------------------------------------------------------------------
// Hostile input
// ---------------------------------------------------------------------------

test("buildInvoiceInlineEmailHtml: hostile client text cannot break out of the markup", () => {
  const hostile = withInput({
    clientName: '"><script>alert(1)</script><img src=x onerror=alert(2)>',
    billingContactName: "'\"><b>oops</b>",
  });
  const html = buildInvoiceInlineEmailHtml(hostile);

  // Caller-supplied names are not rendered at all — stronger than escaping.
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("alert("));
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes("oops"));
  // Still exactly one image, and the structure is unchanged.
  assert.equal(html.split("<img").length - 1, 1);
  assert.equal(html, buildInvoiceInlineEmailHtml(BASE));
});

test("buildInvoiceInlineEmailHtml: the alt attribute is never terminated early", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  // One opening alt=" and one closing quote => exactly 2 quotes around it.
  const alt = /alt="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.ok(!alt.includes('"'));
  assert.ok(!alt.includes("<"));
  assert.ok(!alt.includes(">"));
});

test("invalid BillingInvoiceInput is rejected by every export", () => {
  const cases: Array<[string, Partial<BillingInvoiceInput>]> = [
    ["bad invoice number", { invoiceNumber: 'LG"><img' }],
    ["empty invoice number", { invoiceNumber: "" }],
    ["bad due date", { dueDate: "07-08-2026" }],
    ["impossible date", { dueDate: "2026-02-30" }],
    ["non-EGP currency", { currency: "USD" as BillingInvoiceInput["currency"] }],
    ["negative amount", { amountPiasters: -1 }],
    ["fractional amount", { amountPiasters: 1.5 }],
    ["empty client name", { clientName: "   " }],
    ["period ends before it starts", { servicePeriodEnd: "2026-08-01" }],
  ];

  for (const [label, patch] of cases) {
    const bad = withInput(patch);
    assert.throws(() => invoiceImageCid(bad), `invoiceImageCid: ${label}`);
    assert.throws(
      () => invoiceImageFileName(bad),
      `invoiceImageFileName: ${label}`,
    );
    assert.throws(
      () => buildInvoiceInlineEmailHtml(bad),
      `buildInvoiceInlineEmailHtml: ${label}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The body is ONLY the invoice — no shell, no summary, no CTA
// ---------------------------------------------------------------------------

test("buildInvoiceInlineEmailHtml: none of the beige email-shell markers survive", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  // Palette from lib/email-shell.ts — the beige surface and its hairlines.
  for (const marker of ["#F5F1E6", "#E7E2D3", "#6B675C", "#0A0A0C"]) {
    assert.ok(
      !html.toUpperCase().includes(marker.toUpperCase()),
      `shell colour ${marker} must not appear`,
    );
  }
  // The shell's hidden preheader trick must not be present either.
  assert.ok(!html.includes("&#8204;"));
  assert.ok(!html.toLowerCase().includes("preheader"));
});

test("buildInvoiceInlineEmailHtml: no visible prose, summary rows or CTA", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);

  for (const tag of ["<p", "<h1", "<h2", "<h3", "<a ", "<ul", "<li", "<button"]) {
    assert.ok(!html.includes(tag), `${tag} must not appear in the body`);
  }
  for (const copy of [
    "Hello",
    "Amount due",
    "Thank you",
    "Please find",
    "Invoice number",
    "Service period",
    "Installment",
    "Pay ",
  ]) {
    assert.ok(!html.includes(copy), `copy "${copy}" must not appear`);
  }
});

test("buildInvoiceInlineEmailHtml: the only text is inside the alt attribute", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  // Strip every tag; nothing renderable may remain between them.
  const visible = html.replace(/<[^>]+>/g, "").trim();
  assert.equal(visible, "");
});

test("buildInvoiceInlineEmailHtml: no data: URI and no remote image", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  assert.ok(!html.includes("data:"), "data: URIs are stripped by Gmail");
  assert.ok(!html.includes("http://"));
  assert.ok(!html.includes("https://"));
  assert.ok(!html.includes("//"), "no protocol-relative URL either");
});

test("buildInvoiceInlineEmailHtml: uses a table wrapper on a black canvas", () => {
  const html = buildInvoiceInlineEmailHtml(BASE);
  assert.ok(html.startsWith("<table"));
  assert.ok(html.includes('role="presentation"'));
  assert.ok(html.trimEnd().endsWith("</table>"));
  assert.ok(html.includes("background-color:#000000"));
});
