/**
 * Feature gating for V3 creative-asset ingestion.
 *
 * The entire pipeline (structural-sync enqueue + the worker) is gated behind
 * ASSET_INGESTION_ENABLED and defaults to OFF. When disabled, the enqueue hook
 * and the worker are no-ops.
 */
export function isIngestionEnabled(): boolean {
  return process.env.ASSET_INGESTION_ENABLED === "true";
}
