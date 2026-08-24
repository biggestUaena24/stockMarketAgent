import assert from "node:assert/strict";
import test from "node:test";
import { resolveImportFxRate } from "../../lib/import/fx-rate";
import type { NormalizedHolding } from "../../lib/import/types";

function holding(
  currency: "CAD" | "USD",
  fxRate?: number,
): NormalizedHolding {
  return {
    source: "wealthsimple",
    kind: "holding",
    symbol: "EXMP",
    exchange: "NASDAQ",
    quantity: 2,
    currency,
    averageCost: 75,
    fxRate,
    asOfDate: "2026-08-24",
    importId: "wsh_example",
    rowHash: "example",
    rowNumber: 3,
  };
}

test("prefers a holdings-report FX rate over the preview fallback", () => {
  assert.equal(resolveImportFxRate(holding("USD", 1.4), 1.35), 1.4);
});

test("uses the fallback only when a USD row has no reported FX rate", () => {
  assert.equal(resolveImportFxRate(holding("USD"), 1.35), 1.35);
  assert.equal(resolveImportFxRate(holding("USD"), null), null);
});

test("always records CAD rows at one CAD per CAD", () => {
  assert.equal(resolveImportFxRate(holding("CAD", 1.4), 1.35), 1);
});
