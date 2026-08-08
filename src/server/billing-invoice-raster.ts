// ============================================================================
// Rasterize the approved Loopa invoice PDF to a PNG for inline email display.
//
// WHY THIS EXISTS: no mainstream email client renders application/pdf as
// message content, so the invoice cannot be shown in the body as a PDF. The
// client must still SEE the invoice, not a summary of it.
//
// WHY IT RASTERIZES THE PDF RATHER THAN REDRAWING THE INVOICE: the input here
// is the exact PDF Buffer that is attached to the same email. The image is
// therefore a decode of the attachment, not a second rendering of the same
// data — so the body image and the attached document cannot disagree about an
// amount, a date or an invoice number, even in principle. Redrawing the
// artwork with a second text engine would reintroduce exactly the drift this
// avoids (and would need its own baseline calibration, since the template
// coordinates in billing-invoice-doc.tsx are measured against @react-pdf's
// text-box model).
//
// No filesystem writes, no network, no persistent cache. Everything is in
// memory and the pdfjs document is always destroyed.
// ============================================================================

import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The approved invoice is a single A4 page: 595.28 x 841.89 pt. pdfjs renders
 * at 1 px per pt at scale 1, so this scale yields 1200 x 1697 px — 2x the
 * 600px display width used in the email, i.e. sharp on retina and on the Gmail
 * mobile apps. Proven in the Step 0 spike; changing it changes the email.
 */
const PDF_PAGE_WIDTH_PT = 595.28;
const TARGET_WIDTH_PX = 1200;
const RENDER_SCALE = TARGET_WIDTH_PX / PDF_PAGE_WIDTH_PT;

/** The 8-byte PNG signature every valid PNG starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * One font that must exist inside standard_fonts for the directory to be
 * usable. Liberation Sans is the metric-compatible substitute pdfjs uses for
 * the invoice's Helvetica text, so if this file is missing the render is wrong.
 */
const STANDARD_FONT_PROBE = "LiberationSans-Regular.ttf";

/**
 * Absolute path to pdfjs-dist's bundled Liberation fonts, as pdfjs wants it.
 *
 * FORMAT MATTERS, and both halves were established empirically:
 *   - pdfjs rejects a value that does not end in "/" ("must include trailing
 *     slash"), and a Windows path ends in "\".
 *   - pdfjs cannot fetch a file:// URL under Node, so pathToFileURL is wrong
 *     here — it fails with "Unable to load font data" and then silently
 *     substitutes a font with mismatched advances, which corrupts the spacing
 *     of every dynamic value on the invoice.
 * A plain forward-slash filesystem path with a trailing slash is the one form
 * that works.
 *
 * These fonts are needed because the approved PDF references the non-embedded
 * standard-14 Helvetica for its Latin text; pdfjs substitutes the
 * metric-compatible Liberation Sans, which it can only do if it can load it.
 *
 * WHY process.cwd() AND NOT MODULE-RELATIVE RESOLUTION: this module is part of
 * a "use server" import graph, so Next compiles it into the action-browser
 * webpack layer, where `createRequire(...)` is rewritten to the literal
 * `undefined` — every module-location API is unavailable there. cwd is the
 * application root under both `next dev` and `next start`, and it is the same
 * anchor billing-invoice-doc.tsx already uses successfully in this very layer
 * to load the invoice template and fonts. Do not reintroduce createRequire,
 * import.meta.url or require.resolve here; they cannot work.
 *
 * The existsSync probe replaces the robustness that module resolution would
 * have given: a wrong path becomes a loud failure instead of a silently
 * mis-rendered invoice.
 */
function resolveStandardFontDir(): string {
  const dir = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts",
  );

  if (!existsSync(path.join(dir, STANDARD_FONT_PROBE))) {
    // Deliberately NOT a warning-and-continue: missing standard fonts do not
    // stop the render, they corrupt the letter spacing of every dynamic value
    // on the invoice, which would reach the client looking authentic.
    throw new Error(
      "Invoice rasterizer: pdfjs standard fonts are unavailable.",
    );
  }

  return `${dir.replace(/\\/g, "/")}/`;
}

/** Error text safe to surface: no credentials, no transport configuration. */
function describeCause(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

/**
 * Render page 1 of `pdf` to a PNG Buffer.
 *
 * Throws — loudly and with a sanitized message — if the toolchain is missing
 * or the render fails. Callers treat that exactly like an SMTP failure: the
 * invoice stays persisted and the delivery row goes to FAILED, so a manual
 * retry is still possible.
 */
export async function rasterizeInvoicePdf(pdf: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
    throw new Error("Invoice rasterizer: input must be a non-empty PDF Buffer");
  }

  const standardFontDataUrl = resolveStandardFontDir();

  // Lazy: keeps the native canvas binary and the pdfjs worker out of the
  // module graph until an invoice is actually being sent.
  let pdfToImg: typeof import("pdf-to-img");
  try {
    pdfToImg = await import("pdf-to-img");
  } catch (err) {
    throw new Error(
      "Invoice rasterizer: pdf-to-img could not be loaded. This usually means " +
        "the optional @napi-rs/canvas native binary is missing for this " +
        "platform, or the Node version is below the package minimum. " +
        describeCause(err),
    );
  }

  let doc: Awaited<ReturnType<typeof pdfToImg.pdf>> | null = null;
  let png: Buffer;
  try {
    doc = await pdfToImg.pdf(pdf, {
      scale: RENDER_SCALE,
      docInitParams: {
        standardFontDataUrl,
        // NOTE ON `isEvalSupported: false`
        //
        // It was planned here as defence in depth for GHSA-hq66-cqwq-w95j, and
        // it is deliberately NOT passed. The pinned pdfjs-dist 6.2.108 removed
        // the option AND the eval-based code path it used to disable: the
        // string "isEvalSupported" and the `new Function(` constructor both
        // occur zero times in pdf.mjs and pdf.worker.mjs. It no longer
        // typechecks, and passing it would be a silently ignored no-op that
        // implies a protection the flag is not providing.
        //
        // The upgrade itself is the fix. Do not re-add this without first
        // confirming the option exists in the installed version.
      },
    });

    png = await doc.getPage(1);
  } catch (err) {
    throw new Error(
      `Invoice rasterizer: rendering the invoice image failed. ${describeCause(err)}`,
    );
  } finally {
    // Always released, including when getPage throws, so a failed send cannot
    // leak a pdfjs worker or a canvas handle.
    if (doc !== null) {
      try {
        await doc.destroy();
      } catch {
        // Teardown failure must never mask the real outcome.
      }
    }
  }

  if (!Buffer.isBuffer(png) || png.length === 0) {
    throw new Error("Invoice rasterizer: produced an empty image");
  }
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Invoice rasterizer: output is not a valid PNG");
  }

  return png;
}
