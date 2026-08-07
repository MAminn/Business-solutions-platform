import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEmailShell,
  escapeHtml,
  paragraph,
  detailTable,
  amountCallout,
} from "./email-shell";

function sample(overrides: Partial<Parameters<typeof buildEmailShell>[0]> = {}) {
  return buildEmailShell({
    preheader: "EGP 5,000.00 due 2026-08-07",
    eyebrow: "Service fee invoice",
    title: "Service fee invoice LG-INV-2026-0001",
    bodyHtml: "<p>Body content here</p>",
    footerText: "Installment 1 of 2",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Branding and structure
// ---------------------------------------------------------------------------

test("contains the Loopa wordmark as TEXT, not an image", () => {
  const html = sample();
  assert.ok(html.includes(">Loopa<"), "expected a text Loopa wordmark");
});

test("uses the Loopa palette", () => {
  const html = sample();
  assert.ok(html.includes("#0A0A0C"), "near-black");
  assert.ok(html.includes("#C8FF2E"), "lime accent");
  assert.ok(html.includes("#F5F1E6"), "off-white surface");
});

test("includes the title and the body", () => {
  const html = sample();
  assert.ok(html.includes("Service fee invoice LG-INV-2026-0001"));
  assert.ok(html.includes("<p>Body content here</p>"));
});

test("includes the preheader, hidden from the rendered body", () => {
  const html = sample();
  assert.ok(html.includes("EGP 5,000.00 due 2026-08-07"));
  assert.ok(html.includes("display:none"), "preheader must be visually hidden");
});

test("includes eyebrow and footer when supplied, omits them when not", () => {
  const withAll = sample();
  assert.ok(withAll.includes("Service fee invoice"));
  assert.ok(withAll.includes("Installment 1 of 2"));

  const minimal = buildEmailShell({
    preheader: "p",
    title: "t",
    bodyHtml: "<p>b</p>",
  });
  assert.ok(minimal.includes("<p>b</p>"));
  assert.ok(!minimal.includes("Installment 1 of 2"));
});

// ---------------------------------------------------------------------------
// No external asset dependency — the email must render with images blocked
// ---------------------------------------------------------------------------

test("has no external image or remote asset dependency", () => {
  const html = sample();
  assert.ok(!html.includes("<img"), "no <img> tags");
  assert.ok(!/https?:\/\//.test(html), "no absolute http(s) URLs");
  assert.ok(!html.includes("url("), "no CSS url() references");
  assert.ok(!html.includes("background-image"), "no background images");
  assert.ok(!html.includes("@import"), "no font/style imports");
});

test("uses table-based layout with inline styles", () => {
  const html = sample();
  assert.ok(html.includes('role="presentation"'));
  assert.ok(html.includes("style="));
  assert.ok(!html.includes("<style"), "no <style> block");
});

// ---------------------------------------------------------------------------
// Escaping contract
// ---------------------------------------------------------------------------

test("escapeHtml escapes all five significant characters", () => {
  assert.equal(
    escapeHtml(`<Mach & "Co">`),
    "&lt;Mach &amp; &quot;Co&quot;&gt;",
  );
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml escapes ampersand first, avoiding double-encoding", () => {
  // If & were escaped last, "&lt;" would become "&amp;lt;".
  assert.equal(escapeHtml("<"), "&lt;");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("plain-text fields are escaped by the shell", () => {
  const html = buildEmailShell({
    preheader: `<script>alert(1)</script>`,
    eyebrow: `<b>eyebrow</b>`,
    title: `<Mach & "Co">`,
    bodyHtml: "<p>safe</p>",
    footerText: `<i>footer</i>`,
  });
  assert.ok(!html.includes("<script>"), "script tag must not survive");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;Mach &amp; &quot;Co&quot;&gt;"));
  assert.ok(!html.includes("<b>eyebrow</b>"));
  assert.ok(!html.includes("<i>footer</i>"));
});

test("bodyHtml is TRUSTED and inserted verbatim — documented contract", () => {
  // This is the one field the shell cannot escape, because callers need real
  // markup. The caller is responsible for escaping anything dynamic it puts
  // in. src/server/billing-invoice.ts does exactly that.
  const html = buildEmailShell({
    preheader: "p",
    title: "t",
    bodyHtml: "<p><strong>bold</strong></p>",
  });
  assert.ok(html.includes("<p><strong>bold</strong></p>"));
});

// ---------------------------------------------------------------------------
// Body-composition helpers escape their own inputs
// ---------------------------------------------------------------------------

test("paragraph escapes its text", () => {
  assert.ok(paragraph(`<Mach & "Co">`).includes("&lt;Mach &amp; &quot;Co&quot;&gt;"));
  assert.ok(!paragraph("<b>x</b>").includes("<b>"));
});

test("detailTable escapes labels and values", () => {
  const html = detailTable([["Client", `<Mach & "Co">`]]);
  assert.ok(html.includes("&lt;Mach &amp; &quot;Co&quot;&gt;"));
  assert.ok(!html.includes(`<Mach`));
});

test("amountCallout escapes its label and amount", () => {
  const html = amountCallout("Amount due", "<EGP>");
  assert.ok(html.includes("&lt;EGP&gt;"));
});

test("output is a complete, deterministic HTML document", () => {
  const a = sample();
  const b = sample();
  assert.equal(a, b, "same input must produce identical output");
  assert.ok(a.startsWith("<!DOCTYPE html>"));
  assert.ok(a.trimEnd().endsWith("</html>"));
});
