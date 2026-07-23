/** Compact currency, e.g. $357.2K, EGP 198.0K, $1.2M */
export function formatCurrencyCompact(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    // Unknown/invalid ISO code — plain compact number, no symbol.
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
}

/** Full currency, e.g. $18,420 */
export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Full currency with 2 decimals, e.g. $22.40 */
export function formatCurrencyExact(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Percentage. value is in 0-1 range. */
export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Percentage already in 0-100 range. */
export function formatPercentRaw(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Multiplier, e.g. 3.42x */
export function formatMultiplier(value: number, digits = 2): string {
  return `${value.toFixed(digits)}x`;
}

/** Integer with thousand separators */
export function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Signed delta, e.g. +12.4%, -3.1% */
export function formatDelta(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}
