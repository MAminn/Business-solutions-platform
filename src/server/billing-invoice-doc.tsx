/**
 * Loopa "Service Fee Invoice" PDF (@react-pdf/renderer).
 *
 * ⚠️ TERMINOLOGY: a SERVICE FEE INVOICE — Loopa's operational invoice for its
 * own monthly service fee. NOT a tax invoice, VAT invoice, or any official
 * Egyptian statutory tax document. No VAT/tax is calculated, no tax
 * registration is claimed, and no legal company identifier is invented.
 *
 * VISUAL SOURCE OF TRUTH: the artwork is NOT recreated here. The page is the
 * user's own "Loopa Invoice Template", sanitised into a static background
 * (public/billing/loopa-invoice-template.png) with only the sample data removed.
 * The LP mark, the LOOPA / GROWTH lockup, the INVOICE display type, the blue
 * paint stroke, the brush textures, the lime table header, the rules, and the
 * blue DUE TOTAL bar are all the ORIGINAL rendered artwork — pixels from the
 * template, never primitives drawn by this file.
 *
 * This module therefore does exactly two things: paint that background, and
 * overlay the dynamic invoice values at the template's own coordinates.
 *
 * Pure presentation. No database access, no Date.now(), no environment reads,
 * no network, no remote images, no external URLs. Every value on the page comes
 * from the explicit input, so the same input always renders the same document.
 * Rendered IN MEMORY to a Buffer and never written to disk.
 *
 * MONEY: formatted only via formatInvoiceAmount (integer piasters →
 * piastersToDecimalString). No Number(), parseFloat(), toFixed(), or
 * Decimal.toNumber() anywhere in this file.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
// Explicit React import: the repo's tsconfig uses `jsx: "preserve"`, which Next
// compiles with the automatic runtime, but the `tsx` test runner (esbuild)
// falls back to the classic runtime and needs React in scope. Importing it
// keeps this module renderable under BOTH, so the PDF can be unit-tested.
import * as React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  assertValidInvoiceInput,
  formatInvoiceAmount,
  installmentLabel,
  servicePeriodLabel,
  SERVICE_DESCRIPTION,
  type BillingInvoiceInput,
} from "@/server/billing-invoice";

// ---------------------------------------------------------------------------
// Static template background.
//
// Derived from the user's original "Loopa Invoice Template.pdf": rasterised at
// 288 DPI (2382 x 3369, A4 aspect) and sanitised so ONLY the sample data is
// gone — the sample client block, sample invoice number/dates, the four sample
// service rows, the sample totals, the DISCOUNT row (our input model has no
// discount field), and the payment-method logos (no Loopa payment methods are
// confirmed, so none are shown).
//
// Read from the committed public/ asset at render time, exactly like the
// creative report reads its committed fonts. Nothing is downloaded and nothing
// is written to disk.
// ---------------------------------------------------------------------------
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public/billing/loopa-invoice-template.png",
);

/**
 * The PNG is passed to <Image> as raw BYTES, not as a path. A Windows absolute
 * path such as "D:\repo\public\..." is parsed by @react-pdf as a URL whose
 * scheme is the drive letter, so it resolves to nothing and the background
 * silently fails to embed. Bytes remove that ambiguity entirely.
 *
 * Read once and cached, so a batch of invoices does not re-read the asset.
 */
let templateBytes: Buffer | null = null;
function templateImage(): { data: Buffer; format: "png" } {
  if (templateBytes === null) {
    templateBytes = readFileSync(TEMPLATE_PATH);
  }
  return { data: templateBytes, format: "png" };
}

Font.register({
  family: "LoopaInvoice",
  fonts: [
    {
      src: path.join(process.cwd(), "public/fonts/NotoSansArabic-Regular.woff"),
      fontWeight: "normal",
    },
    {
      src: path.join(process.cwd(), "public/fonts/NotoSansArabic-Bold.woff"),
      fontWeight: "bold",
    },
  ],
});

/**
 * Colours taken from the original template so overlaid values match the
 * artwork they sit in.
 */
const C = {
  lime: "#C8FF2E",
  value: "#C9C9C9",
  white: "#FFFFFF",
} as const;

/**
 * The template was authored on a 595.5 x 842.25 pt page; @react-pdf's "A4" is
 * 595.28 x 841.89 pt. The coordinates below are the TEMPLATE's own, so they are
 * scaled by these factors to land identically on the slightly smaller A4 page.
 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SX = 595.28 / 595.5;
const SY = 841.89 / 842.25;

/**
 * Vertical calibration. Template coordinates are text BASELINES, but @react-pdf
 * positions a text box by its top edge. This is the ascent fraction of the
 * registered font, measured by rendering and comparing the resulting baselines
 * against the template's own.
 */
const ASCENT = 1.3746;

/** Measured baseline corrections (see at()). */
const NUDGE_15_8 = 7.6;
const NUDGE_13 = 6.4;

/**
 * Absolute box placed from the template's own baseline coordinate.
 *
 *  is an empirically MEASURED per-field correction, in points.
 *
 * @react-pdf places a few of these fields ~0.485em higher than the rest despite
 * identical font, size, weight, width and line-height; the cause could not be
 * attributed to any of those, and lineHeight:1 did not change it. Rather than
 * guess, each field's rendered baseline was extracted from the output PDF and
 * compared with the template's own baseline, and the residual is corrected
 * here. Every value is verified to land within 0.3pt of the template.
 *
 * If these ever drift, re-measure — do not hand-tune by eye.
 */
function at(baseline: number, size: number, nudge = 0) {
  return {
    position: "absolute" as const,
    top: (baseline - size * ASCENT) * SY + nudge,
  };
}


/**
 * Emoji and pictographs have no glyph in Noto Sans Arabic and would render as
 * empty boxes. Mirrors the same defence in the creative report. Latin, Arabic,
 * digits, and ordinary punctuation are preserved.
 */
function stripEmoji(value: string): string {
  return value
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const styles = StyleSheet.create({
  page: { fontFamily: "LoopaInvoice" },
  /** Full-bleed original artwork. */
  /**
   * Full-bleed artwork. WIDTH ONLY: the asset is exactly A4 aspect so the
   * height follows. Setting height:"100%" here makes @react-pdf treat the
   * image as filling the page in FLOW, which pushes every overlay onto a
   * second page.
   */
  /**
   * The artwork sits in its OWN absolutely positioned layer. An <Image> placed
   * directly on the Page is treated as flow content even when absolutely
   * positioned: it fills the page and pushes every overlay onto a second page.
   * Wrapping it in an absolute View removes it from the flow entirely.
   */
  backgroundLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: PAGE_W,
    height: PAGE_H,
  },
  backgroundImage: { width: PAGE_W, height: PAGE_H },
  /** Overlay layer: absolute, so it adds no flow height of its own. */
  overlay: { position: "absolute", top: 0, left: 0, width: PAGE_W, height: PAGE_H },

  // --- BILLED TO block (template x = 60) ---------------------------------
  clientName: {
    left: 60 * SX,
    width: 300 * SX,
    fontSize: 15.8,
    fontWeight: "bold",
    color: C.lime,
  },
  contactLine: { left: 60 * SX, width: 300 * SX, fontSize: 13, color: C.value },

  // --- invoice metadata (template x = 442) -------------------------------
  metaValue: {
    left: 442 * SX,
    width: 140 * SX,
    fontSize: 15.8,
    fontWeight: "bold",
    color: C.value,
  },

  // --- table row 1, centred per column like the template ------------------
  cellDescription: {
    left: 60 * SX,
    width: 210 * SX,
    fontSize: 13,
    color: C.white,
    textAlign: "center",
  },
  cellQty: {
    left: 240 * SX,
    width: 55 * SX,
    fontSize: 13,
    color: C.white,
    textAlign: "center",
  },
  cellUnit: {
    left: 310 * SX,
    width: 125 * SX,
    fontSize: 13,
    color: C.white,
    textAlign: "center",
  },
  cellTotal: {
    left: 422 * SX,
    width: 125 * SX,
    fontSize: 13,
    color: C.white,
    textAlign: "center",
  },

  // --- totals -------------------------------------------------------------
  subTotalValue: {
    left: 450 * SX,
    width: 130 * SX,
    fontSize: 15.8,
    fontWeight: "bold",
    color: C.value,
  },
  dueTotalValue: {
    left: 450 * SX,
    width: 130 * SX,
    fontSize: 15.8,
    fontWeight: "bold",
    color: C.white,
  },
});

export function BillingInvoiceDocument({
  input,
}: {
  input: BillingInvoiceInput;
}) {
  const amount = formatInvoiceAmount(input.amountPiasters, input.currency);
  const clientName = stripEmoji(input.clientName);
  const contactName = input.billingContactName
    ? stripEmoji(input.billingContactName)
    : null;
  const installment = installmentLabel(
    input.installmentSequence,
    input.installmentCount,
  );

  // Supporting lines under the client name, in the template's contact block.
  const contactLines = [
    contactName,
    `Service period: ${servicePeriodLabel(input)}`,
    `${installment} · ${input.sharePercent}%`,
  ].filter((line): line is string => line !== null);

  return (
    <Document
      title={`Service fee invoice ${input.invoiceNumber}`}
      author='Loopa'
      subject={SERVICE_DESCRIPTION}>
      <Page size='A4' style={styles.page}>
        {/* The original Loopa template artwork. */}
        <View style={styles.backgroundLayer}>
          <Image src={templateImage()} style={styles.backgroundImage} />
        </View>

        <View style={styles.overlay}>

        {/* BILLED TO */}
        <Text style={[styles.clientName, at(272, 15.8, NUDGE_15_8)]}>{clientName}</Text>
        {contactLines.map((line, i) => (
          <Text key={i} style={[styles.contactLine, at(297 + i * 19, 13)]}>
            {line}
          </Text>
        ))}

        {/* INVOICE # / DATE / DUE DATE */}
        <Text style={[styles.metaValue, at(245, 15.8, NUDGE_15_8)]}>
          {input.invoiceNumber}
        </Text>
        <Text style={[styles.metaValue, at(282, 15.8, NUDGE_15_8)]}>
          {input.invoiceDate}
        </Text>
        <Text style={[styles.metaValue, at(320, 15.8, NUDGE_15_8)]}>{input.dueDate}</Text>

        {/* Single line item. The remaining three template rows stay empty — no
            fabricated services are added merely to fill the table. The invoiced
            amount is THIS INSTALLMENT, never the full monthly fee. */}
        <View>
          <Text style={[styles.cellDescription, at(451, 13)]}>
            Loopa Monthly Service Fee
          </Text>
          <Text style={[styles.cellQty, at(451, 13, NUDGE_13)]}>1</Text>
          <Text style={[styles.cellUnit, at(451, 13)]}>{amount}</Text>
          <Text style={[styles.cellTotal, at(451, 13)]}>{amount}</Text>
        </View>

        {/* Totals. No DISCOUNT row and no tax/VAT row exist on this document. */}
        <Text style={[styles.subTotalValue, at(657, 15.8)]}>{amount}</Text>
        <Text style={[styles.dueTotalValue, at(736, 15.8)]}>{amount}</Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Render the invoice to a PDF Buffer, in memory.
 *
 * Input is validated FIRST, so an invalid amount, date, currency, or
 * installment can never be drawn onto a document that reaches a client.
 *
 * Declared `async` so the API has ONE failure channel: validation errors
 * surface as a rejected Promise, exactly like a render failure, rather than
 * throwing synchronously before the returned Promise exists.
 */
export async function renderBillingInvoicePdf(
  input: BillingInvoiceInput,
): Promise<Buffer> {
  assertValidInvoiceInput(input);
  return renderToBuffer(<BillingInvoiceDocument input={input} />);
}
