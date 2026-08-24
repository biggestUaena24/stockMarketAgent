import type {
  NormalizedWealthsimpleRecord,
} from "./types";

/**
 * Resolves the CAD-per-native-currency rate used for a normalized ledger row.
 * CAD is always 1. Official holdings reports may carry a book-value-derived
 * rate; the owner's preview fallback is used only when the row has none.
 */
export function resolveImportFxRate(
  record: NormalizedWealthsimpleRecord,
  fallback: number | null,
): number | null {
  if (record.currency === "CAD") {
    return 1;
  }
  return record.fxRate ?? fallback;
}
