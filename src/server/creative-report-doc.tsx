/**
 * Branded "Creative Analysis Report" PDF document (@react-pdf/renderer).
 *
 * Pure presentation: receives already-aggregated, already-verdicted creative
 * rows and renders them. No data access, no Meta calls, no date math beyond
 * the preformatted label strings handed in by the route. All numeric/currency
 * formatting goes through @/lib/format.
 *
 * Brand:
 *   background #0A0A0C · surfaces #F5F1E6 · accent #1B47FF ·
 *   positive highlight #C8FF2E. Bold condensed headers, mono-ish body,
 *   one accent per page, numbers right-aligned in tables.
 */

import path from "node:path";
import {
  Document,
  Image,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  formatCurrencyExact,
  formatInt,
  formatMultiplier,
  formatPercentRaw,
} from "@/lib/format";

// ---------------------------------------------------------------------------
// Font registration (committed static WOFF assets — @react-pdf/renderer cannot
// embed variable fonts). Registered once at module load. "NotoArabic" gives
// Latin + Arabic glyph coverage so user copy renders real glyphs instead of
// mojibake. NOTE: RTL ordering is a known MVP limitation — glyphs render, but
// word order may come out left-to-right. Deferred, not fixed here.
// ---------------------------------------------------------------------------
Font.register({
  family: "NotoArabic",
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

// ---------------------------------------------------------------------------
// Public data contract (the route builds this).
// ---------------------------------------------------------------------------

export type Verdict = "Kill" | "Refresh" | "Scale" | "Hold/Watch";

export const VERDICTS: Verdict[] = ["Scale", "Refresh", "Hold/Watch", "Kill"];

/**
 * Number of creative cards rendered in "Top creatives by spend". Exported so
 * the report route resolves images for exactly the rows that get a card
 * instead of for every spender.
 */
export const TOP_CREATIVE_CARDS = 8;

export interface CreativeReportRow {
  name: string;
  type: string;
  headline: string | null;
  bodyText: string | null;
  callToAction: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** Stored as a 0–100 percentage. */
  ctr: number;
  cpm: number;
  /** null when there are no purchases (CPA undefined). */
  cpa: number | null;
  roas: number;
  frequency: number;
  purchases: number;
  fatigued: boolean;
  verdict: Verdict;
  /**
   * Pre-resolved creative image as a self-contained data URI
   * ("data:image/jpeg;base64,..." or the PNG equivalent — the only two
   * formats @react-pdf/renderer embeds reliably). Built by the report route,
   * which reads stored asset bytes / fetches the Meta URLs. null (or absent)
   * when every source failed, in which case the card shows the NO IMAGE box.
   */
  imageDataUri?: string | null;
}

export interface CreativeReportData {
  clientName: string;
  accountName: string;
  platformAccountId: string;
  currency: string;
  /** e.g. "2026-05-18 → 2026-06-16 (last 30 days, anchored on latest data)". */
  windowLabel: string;
  /** e.g. "2026-06-17 14:32". */
  generatedAtLabel: string;
  /** Sorted by 30-day spend descending. */
  creatives: CreativeReportRow[];
  verdictCounts: Record<Verdict, number>;
  /** % of total spend sitting on below-quality-threshold creatives. */
  belowThresholdSpendPct: number;
  /** Count of creatives with spend > 0 in the window. */
  spenderCount: number;
}

const META_DISCLAIMER =
  "Revenue, ROAS, and CPA are Meta-reported and not reconciled against real sales.";

/**
 * Removes emoji / pictographic symbols (and their joiners, variation
 * selectors, regional-indicator flags, and keycap combiners) from a string,
 * collapsing any resulting double spaces. Arabic and Latin letters, digits,
 * and normal punctuation are preserved — only emoji/symbol pictographs go.
 */
function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "") // regional indicators (flags)
    .replace(/\p{Extended_Pictographic}/gu, "") // emoji & pictographs
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "") // selectors/ZWJ/keycap
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const C = {
  bg: "#0A0A0C",
  surface: "#F5F1E6",
  accent: "#1B47FF",
  positive: "#C8FF2E",
  kill: "#FF4D4D",
  ink: "#0A0A0C",
  muted: "#6B675C",
  surfaceDim: "#E7E2D3",
  line: "#D8D2C2",
} as const;

function verdictColor(v: Verdict): string {
  switch (v) {
    case "Scale":
      return C.positive;
    case "Refresh":
      return C.accent;
    case "Kill":
      return C.kill;
    default:
      return C.surfaceDim;
  }
}

function verdictTextColor(v: Verdict): string {
  // Lime and the dim surface read better with dark ink; blue/red with surface.
  return v === "Scale" || v === "Hold/Watch" ? C.ink : C.surface;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.bg,
    color: C.surface,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "NotoArabic",
    fontSize: 9,
  },

  // Cover
  coverKicker: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    letterSpacing: 2,
    color: C.accent,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  coverTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 30,
    color: C.surface,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  coverSub: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: C.positive,
    marginBottom: 18,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
  },
  metaCell: { width: "50%", marginBottom: 8 },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 1,
    color: C.muted,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: { fontSize: 10, color: C.surface },
  disclaimerCover: {
    marginTop: 18,
    fontSize: 8,
    color: C.muted,
    borderTopWidth: 1,
    borderTopColor: "#222227",
    paddingTop: 8,
  },

  // Section heading
  sectionHead: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    letterSpacing: 0.5,
    color: C.surface,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 10,
  },
  accentBar: {
    width: 28,
    height: 3,
    backgroundColor: C.accent,
    marginBottom: 8,
  },

  // Verdict strip
  verdictStrip: { flexDirection: "row", gap: 8 },
  verdictTile: {
    flex: 1,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  verdictCount: { fontFamily: "Helvetica-Bold", fontSize: 22 },
  verdictName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },

  // Spend-quality headline
  qualityCard: {
    backgroundColor: "#141418",
    borderLeftWidth: 3,
    borderLeftColor: C.positive,
    borderRadius: 4,
    padding: 14,
  },
  qualityBig: {
    fontFamily: "Helvetica-Bold",
    fontSize: 26,
    color: C.positive,
  },
  qualityText: { fontSize: 9, color: C.surface, marginTop: 4 },

  // Creative card
  card: {
    backgroundColor: C.surface,
    color: C.ink,
    borderRadius: 5,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    gap: 12,
  },
  imageBox: {
    width: 78,
    height: 78,
    backgroundColor: C.surfaceDim,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  // Fills the 78x78 box. "cover" preserves the source aspect ratio by
  // cropping the overflowing axis, so the card dimensions never shift.
  cardImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: 3,
  },
  imageBoxLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    letterSpacing: 1,
    color: C.muted,
    textTransform: "uppercase",
  },
  cardBody: { flex: 1 },
  cardHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: C.ink,
    flex: 1,
    marginRight: 8,
  },
  badgeRow: { flexDirection: "row", gap: 4 },
  badge: {
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  fatigueBadge: {
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    backgroundColor: "#FFE2A8",
    color: "#7A5200",
  },
  cardType: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 1,
    color: C.muted,
    textTransform: "uppercase",
    marginTop: 2,
  },
  cardCopy: { fontSize: 8, color: "#3A372F", marginTop: 4 },

  // Metric strip (table)
  metricStrip: {
    flexDirection: "row",
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
  },
  metricCell: { flex: 1 },
  metricLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    letterSpacing: 0.5,
    color: C.muted,
    textTransform: "uppercase",
    textAlign: "right",
  },
  metricValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
    textAlign: "right",
    marginTop: 1,
  },

  // Fatigue watch
  fatigueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#141418",
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 5,
  },
  fatigueName: { fontSize: 9, color: C.surface, flex: 1, marginRight: 8 },
  fatigueMetric: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.positive,
    textAlign: "right",
  },
  note: { fontSize: 7.5, color: C.muted, marginTop: 6 },
  empty: { fontSize: 9, color: C.muted, fontStyle: "normal" },

  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#222227",
    paddingTop: 8,
  },
  footerText: { fontSize: 7, color: C.muted },
});

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <Text
      style={[
        styles.badge,
        {
          backgroundColor: verdictColor(verdict),
          color: verdictTextColor(verdict),
        },
      ]}>
      {verdict}
    </Text>
  );
}

function Footer({ data }: { data: CreativeReportData }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        {META_DISCLAIMER} · Window {data.windowLabel} · Generated{" "}
        {data.generatedAtLabel}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function CreativeReportDocument({ data }: { data: CreativeReportData }) {
  const { currency } = data;
  const fatigued = data.creatives.filter((c) => c.fatigued);
  const topCards = data.creatives.slice(0, TOP_CREATIVE_CARDS);

  return (
    <Document
      title={`Creative Analysis Report — ${data.clientName}`}
      author='Media Buyer OS'>
      <Page size='A4' style={styles.page} wrap>
        {/* Cover */}
        <Text style={styles.coverKicker}>Creative Analysis Report</Text>
        <Text style={styles.coverTitle}>{data.clientName}</Text>
        <Text style={styles.coverSub}>{data.accountName}</Text>

        <View style={styles.metaGrid}>
          <MetaCell label='Ad account' value={data.platformAccountId} />
          <MetaCell label='Currency' value={currency} />
          <MetaCell label='Data window' value={data.windowLabel} />
          <MetaCell label='Generated' value={data.generatedAtLabel} />
          <MetaCell
            label='Creatives with spend'
            value={formatInt(data.spenderCount)}
          />
        </View>
        <Text style={styles.disclaimerCover}>{META_DISCLAIMER}</Text>

        {/* Verdict strip */}
        <Text style={styles.sectionHead}>Verdicts</Text>
        <View style={styles.accentBar} />
        <View style={styles.verdictStrip}>
          {VERDICTS.map((v) => (
            <View
              key={v}
              style={[
                styles.verdictTile,
                { backgroundColor: verdictColor(v) },
              ]}>
              <Text
                style={[styles.verdictCount, { color: verdictTextColor(v) }]}>
                {formatInt(data.verdictCounts[v])}
              </Text>
              <Text
                style={[styles.verdictName, { color: verdictTextColor(v) }]}>
                {v}
              </Text>
            </View>
          ))}
        </View>

        {/* Spend-quality headline */}
        <Text style={styles.sectionHead}>Spend quality</Text>
        <View style={styles.accentBar} />
        <View style={styles.qualityCard}>
          <Text style={styles.qualityBig}>
            {formatPercentRaw(data.belowThresholdSpendPct)}
          </Text>
          <Text style={styles.qualityText}>
            of 30-day spend is wasted on Kill creatives (spending with zero
            purchases). The lower this number, the healthier the account&apos;s
            creative mix.
          </Text>
        </View>

        {/* Top creative cards */}
        <Text style={styles.sectionHead}>Top creatives by spend</Text>
        <View style={styles.accentBar} />
        {topCards.length === 0 ? (
          <Text style={styles.empty}>
            No creatives with spend in this window.
          </Text>
        ) : (
          topCards.map((cr, i) => (
            <View key={i} style={styles.card} wrap={false}>
              <View style={styles.imageBox}>
                {cr.imageDataUri ? (
                  <Image style={styles.cardImage} src={cr.imageDataUri} />
                ) : (
                  <Text style={styles.imageBoxLabel}>No image</Text>
                )}
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle}>{stripEmoji(cr.name)}</Text>
                  <View style={styles.badgeRow}>
                    {cr.fatigued ? (
                      <Text style={styles.fatigueBadge}>Fatigue</Text>
                    ) : null}
                    <VerdictBadge verdict={cr.verdict} />
                  </View>
                </View>
                <Text style={styles.cardType}>{cr.type}</Text>
                {cr.headline ? (
                  <Text style={styles.cardCopy}>{stripEmoji(cr.headline)}</Text>
                ) : null}
                {cr.bodyText ? (
                  <Text style={styles.cardCopy}>{stripEmoji(cr.bodyText)}</Text>
                ) : null}

                <View style={styles.metricStrip}>
                  <Metric
                    label='Spend'
                    value={formatCurrencyExact(cr.spend, currency)}
                  />
                  <Metric label='CTR' value={formatPercentRaw(cr.ctr)} />
                  <Metric
                    label='CPM'
                    value={formatCurrencyExact(cr.cpm, currency)}
                  />
                  <Metric label='Freq' value={formatMultiplier(cr.frequency)} />
                  <Metric
                    label='Meta CPA'
                    value={
                      cr.cpa === null
                        ? "n/a"
                        : formatCurrencyExact(cr.cpa, currency)
                    }
                  />
                  <Metric label='Meta ROAS' value={formatMultiplier(cr.roas)} />
                </View>
              </View>
            </View>
          ))
        )}

        {/* Fatigue watch */}
        <Text style={styles.sectionHead}>Fatigue watch</Text>
        <View style={styles.accentBar} />
        {fatigued.length === 0 ? (
          <Text style={styles.empty}>
            No creatives are showing a fatigue trend in this window.
          </Text>
        ) : (
          fatigued.map((cr, i) => (
            <View key={i} style={styles.fatigueRow}>
              <Text style={styles.fatigueName}>{stripEmoji(cr.name)}</Text>
              <Text style={styles.fatigueMetric}>
                Freq {formatMultiplier(cr.frequency)} · CTR{" "}
                {formatPercentRaw(cr.ctr)}
              </Text>
            </View>
          ))
        )}
        <Text style={styles.note}>
          Fatigue is computed from the daily CTR/frequency trend with the 2 most
          recent days excluded — trailing days are stale because the sync upsert
          does not refresh ctr/frequency on re-pull.
        </Text>

        <Footer data={data} />
      </Page>
    </Document>
  );
}

/** Renders the report document to a PDF Buffer via @react-pdf/renderer. */
export function renderCreativeReportPdf(
  data: CreativeReportData,
): Promise<Buffer> {
  return renderToBuffer(<CreativeReportDocument data={data} />);
}
