// ============================================================================
// Reusable branded Loopa email shell.
//
// Pure TypeScript: no React, no `server-only`, no Prisma, no Nodemailer, no
// environment reads, no network. Deterministic for identical input, so it is
// safe to unit-test and safe to import from anywhere.
//
// Built for Gmail / Google Workspace and other conservative clients:
//   - table-based layout with role="presentation"
//   - inline styles only (no <style> block, no classes, no media queries that
//     the layout depends on)
//   - no external images, no web fonts, no remote assets of any kind — the
//     "Loopa" wordmark is TEXT, so the email renders fully with remote images
//     blocked, which is Gmail's default for a first-time sender
//   - the email is never one giant image
//
// Intended to be shared by every transactional billing email: installment
// invoices, payment receipts, second-installment reminders, and internal
// billing notifications. Funding alerts are deliberately NOT migrated onto it
// in this commit (src/server/fund-alerts.ts is untouched).
// ============================================================================

/** Loopa palette. Kept local so the shell has no imports at all. */
const BRAND = {
  /** near-black */
  ink: "#0A0A0C",
  /** lime accent */
  lime: "#C8FF2E",
  /** electric blue accent */
  blue: "#1B47FF",
  /** off-white surface */
  surface: "#F5F1E6",
  /** muted body text on the off-white surface */
  muted: "#6B675C",
  /** hairline on the off-white surface */
  hairline: "#E7E2D3",
} as const;

/**
 * Escape a plain-text value for safe insertion into HTML.
 *
 * Escapes the five characters that can break out of text or attribute
 * context. Ampersand MUST be replaced first, otherwise the entities emitted by
 * the later replacements would themselves be double-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailShellInput {
  /**
   * Inbox preview line. Plain text — escaped by the shell.
   */
  preheader: string;
  /**
   * Small label above the title, e.g. "Service fee invoice". Plain text —
   * escaped by the shell.
   */
  eyebrow?: string;
  /** Main heading. Plain text — escaped by the shell. */
  title: string;
  /**
   * ⚠️ TRUSTED HTML. This is the ONE field the shell inserts verbatim.
   *
   * The shell CANNOT escape it — that is the entire point of the field, since
   * callers need paragraphs, tables, and emphasis. Therefore every caller is
   * responsible for escaping any dynamic value it interpolates, using
   * `escapeHtml` from this module, BEFORE passing the string in.
   *
   * Never pass a client-controlled value (client name, contact name, note,
   * reference, …) into this field unescaped. `src/server/billing-invoice.ts`
   * is the reference implementation: every dynamic value there goes through
   * `escapeHtml` before it reaches this field.
   */
  bodyHtml: string;
  /** Footer line. Plain text — escaped by the shell. */
  footerText?: string;
}

/**
 * Wrap trusted body HTML in the branded Loopa shell and return a complete HTML
 * document.
 *
 * Every field except `bodyHtml` is treated as plain text and escaped here.
 */
export function buildEmailShell(input: EmailShellInput): string {
  const preheader = escapeHtml(input.preheader);
  const title = escapeHtml(input.title);
  const eyebrow = input.eyebrow ? escapeHtml(input.eyebrow) : null;
  const footerText = input.footerText ? escapeHtml(input.footerText) : null;

  // Zero-width non-joiners pad the preview text so the client does not pull
  // body copy into the inbox preview line after the preheader.
  const preheaderPadding = "&#8204;&nbsp;".repeat(60);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${preheader}${preheaderPadding}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.ink};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${BRAND.surface};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background-color:${BRAND.ink};padding:20px 28px;">
            <span style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:bold;letter-spacing:-0.5px;color:${BRAND.lime};">Loopa</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            ${
              eyebrow
                ? `<p style="margin:0 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${BRAND.blue};">${eyebrow}</p>`
                : ""
            }
            <h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:20px;line-height:28px;font-weight:bold;color:${BRAND.ink};">${title}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 28px 28px 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${BRAND.ink};">
${input.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px;">
            <div style="height:1px;line-height:1px;font-size:0;background-color:${BRAND.hairline};">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 28px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${BRAND.muted};">
            ${footerText ? `<p style="margin:0 0 6px 0;">${footerText}</p>` : ""}
            <p style="margin:0;">Loopa</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Small helpers for composing `bodyHtml`. They escape their own inputs, so
 * callers can build a body without hand-writing markup.
 */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;">${escapeHtml(text)}</p>`;
}

/**
 * A two-column label/value detail table. Both label and value are plain text
 * and are escaped here.
 */
export function detailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr>
              <td style="padding:6px 12px 6px 0;font-size:13px;color:${BRAND.muted};white-space:nowrap;">${escapeHtml(label)}</td>
              <td style="padding:6px 0;font-size:13px;font-weight:bold;color:${BRAND.ink};">${escapeHtml(value)}</td>
            </tr>`,
    )
    .join("\n");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;font-family:Helvetica,Arial,sans-serif;">
${body}
          </table>`;
}

/** A visually prominent amount callout. `amount` is plain text and escaped. */
export function amountCallout(label: string, amount: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
            <tr>
              <td style="background-color:${BRAND.ink};border-radius:8px;padding:16px 20px;font-family:Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.surface};">${escapeHtml(label)}</p>
                <p style="margin:0;font-size:24px;font-weight:bold;color:${BRAND.lime};">${escapeHtml(amount)}</p>
              </td>
            </tr>
          </table>`;
}
