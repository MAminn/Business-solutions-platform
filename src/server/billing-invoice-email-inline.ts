// ============================================================================
// The client-facing invoice email BODY: the complete invoice, and nothing else.
//
// This deliberately replaces the earlier summary-card presentation. The client
// sees the actual Loopa invoice — the same artwork, values and layout as the
// attached PDF — rendered directly in the message, because a restated summary
// is not the invoice and can drift from it.
//
// The image is referenced by Content-ID, never by URL and never as a data:
// URI. Gmail strips data: URIs from <img> entirely, and a remote https image
// would be proxied, require public hosting, and leak the invoice artwork to a
// fetchable URL. A cid: part is served from inside the message itself, is not
// subject to Gmail's ~102KB body-clipping limit, and renders in Gmail web,
// iOS and Android.
//
// Pure: no Prisma, no I/O, no env, no Date.now(). Deterministic for a given
// input, so the CID in the HTML and the CID on the MIME part are guaranteed to
// be the same string.
//
// There is intentionally NO visible fallback text, heading, paragraph, amount
// card or call to action. Clients with images disabled fall through to the
// text/plain alternative (buildInvoiceEmailText), which carries every figure.
// ============================================================================

import {
  assertValidInvoiceInput,
  formatInvoiceAmount,
  type BillingInvoiceInput,
} from "@/server/billing-invoice";

/** Domain-ish suffix for the Content-ID. Never resolved; not a real host. */
const CID_NAMESPACE = "loopa.invoice";

/** Display width in the client. 600px is the email-safe standard column. */
const DISPLAY_WIDTH_PX = 600;

/**
 * Attribute-safe escaping.
 *
 * Local rather than imported from the email shell so this module cannot pull
 * in any of that presentation. Every dynamic value here is already
 * charset-constrained by assertValidInvoiceInput, so this is defence in depth
 * against a future field being added to the alt text without thought.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Deterministic Content-ID, e.g. "invoice-LG-INV-2026-0001@loopa.invoice".
 *
 * Safe to interpolate unescaped into both a MIME header and an href-style
 * attribute: assertValidInvoiceInput already restricts the invoice number to
 * /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, which contains no quote, angle bracket,
 * whitespace or CID-delimiting character.
 */
export function invoiceImageCid(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);
  return `invoice-${input.invoiceNumber}@${CID_NAMESPACE}`;
}

/**
 * Attachment filename for the inline image, e.g.
 * "loopa-service-fee-invoice-LG-INV-2026-0001.png".
 *
 * Mirrors invoiceFileName()'s conservative approach so the image and the PDF
 * are named consistently in clients that list inline parts as attachments.
 */
export function invoiceImageFileName(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);
  const safe = input.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-");
  return `loopa-service-fee-invoice-${safe}.png`;
}

/**
 * The alt text. This is the only prose in the message body, and it is only
 * ever read aloud or shown when the image cannot be.
 *
 * Deliberately excludes the client name: it adds nothing for the one person
 * receiving their own invoice, and keeping caller-supplied text out of the
 * markup entirely is stronger than escaping it.
 */
function invoiceImageAltText(input: BillingInvoiceInput): string {
  const amount = formatInvoiceAmount(input.amountPiasters, input.currency);
  return `Loopa service fee invoice ${input.invoiceNumber} — ${amount} — due ${input.dueDate}`;
}

/**
 * The complete HTML body: one table, one image.
 *
 * The table wrapper is the email-safe layout primitive (Outlook's Word engine
 * does not lay out divs reliably), and the black background continues the
 * invoice's own canvas so the image does not sit on a white card.
 *
 * The width attribute AND the max-width style are both required: Outlook
 * ignores max-width, and mobile clients need the fluid rule.
 */
export function buildInvoiceInlineEmailHtml(
  input: BillingInvoiceInput,
): string {
  assertValidInvoiceInput(input);

  const cid = invoiceImageCid(input);
  const alt = escapeAttribute(invoiceImageAltText(input));

  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;border-collapse:collapse;background-color:#000000;">`,
    `<tr>`,
    `<td align="center" style="margin:0;padding:0;background-color:#000000;">`,
    `<img src="cid:${cid}" width="${DISPLAY_WIDTH_PX}" alt="${alt}" style="display:block;width:100%;max-width:${DISPLAY_WIDTH_PX}px;height:auto;border:0;outline:none;text-decoration:none;" />`,
    `</td>`,
    `</tr>`,
    `</table>`,
  ].join("");
}
