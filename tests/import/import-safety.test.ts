import assert from "node:assert/strict";
import test from "node:test";

import {
  assessImportSafety,
  type ExistingLedgerEntry,
  type LedgerImportCandidate,
} from "../../lib/import/safety";

const openingCandidate: LedgerImportCandidate = {
  record: {
    source: "wealthsimple",
    kind: "holding",
    symbol: "AAPL",
    exchange: "NASDAQ",
    quantity: 2,
    currency: "USD",
    averageCost: 200,
    asOfDate: "2026-08-01",
    importId: "wsh_later",
    rowHash: "hash-later",
    rowNumber: 2,
  },
  values: {
    action: "BUY",
    canonicalSymbol: "AAPL",
    exchange: "NASDAQ",
    quantity: 2,
    price: 200,
    currency: "USD",
    fee: 0,
    fxRateToCad: 1.35,
    occurredAt: "2026-08-01T12:00:00.000Z",
  },
};

const existingOpening: ExistingLedgerEntry = {
  action: "BUY",
  canonicalSymbol: "AAPL",
  exchange: "NASDAQ",
  quantity: 1,
  price: 190,
  currency: "USD",
  fee: 0,
  fxRateToCad: 1.34,
  occurredAt: "2026-07-01T12:00:00.000Z",
  importId: "wsh_original",
  notes: "Opening position from Wealthsimple holdings CSV",
};

test("blocks a later holdings snapshot when an opening snapshot exists", () => {
  const assessment = assessImportSafety(
    "holdings",
    [openingCandidate],
    [existingOpening],
  );

  assert.deepEqual(
    assessment.globalIssues.map((issue) => issue.code),
    ["HOLDINGS_SNAPSHOT_ALREADY_EXISTS"],
  );
});

test("blocks a holdings baseline after manual security trades", () => {
  const manualBuy: ExistingLedgerEntry = {
    ...existingOpening,
    importId: null,
    notes: "Entered manually",
  };
  const assessment = assessImportSafety(
    "holdings",
    [openingCandidate],
    [manualBuy],
  );

  assert.deepEqual(
    assessment.globalIssues.map((issue) => issue.code),
    ["HOLDINGS_SNAPSHOT_OVERLAPS_LEDGER"],
  );
});

test("blocks activity on or before a holdings baseline but allows later activity", () => {
  const candidate = activityCandidate("2026-07-01", 201);
  const overlapping = assessImportSafety(
    "activities",
    [candidate],
    [existingOpening],
  );
  assert.equal(
    overlapping.issuesByRow
      .get(candidate.record.rowNumber)
      ?.some((issue) => issue.code === "ACTIVITY_OVERLAPS_HOLDINGS_BASELINE"),
    true,
  );

  const later = activityCandidate("2026-07-02", 201);
  const safe = assessImportSafety("activities", [later], [existingOpening]);
  assert.equal(safe.issuesByRow.size, 0);
});

test("flags an exact manual/import duplicate even when times and import IDs differ", () => {
  const candidate = activityCandidate("2026-08-10", 205);
  const manual: ExistingLedgerEntry = {
    ...candidate.values!,
    occurredAt: "2026-08-10T20:15:00.000Z",
    importId: null,
    notes: "Manual entry",
  };
  const assessment = assessImportSafety(
    "activities",
    [candidate],
    [manual],
  );

  assert.equal(
    assessment.issuesByRow
      .get(candidate.record.rowNumber)
      ?.some((issue) => issue.code === "POSSIBLE_LEDGER_DUPLICATE"),
    true,
  );
});

function activityCandidate(
  date: string,
  price: number,
): LedgerImportCandidate {
  return {
    record: {
      source: "wealthsimple",
      kind: "activity",
      activityType: "BUY",
      date,
      currency: "USD",
      symbol: "AAPL",
      exchange: "NASDAQ",
      quantity: 1,
      price,
      fee: 0,
      fxRate: 1.35,
      importId: `wsa_${date}_${price}`,
      rowHash: `hash_${date}_${price}`,
      rowNumber: 4,
    },
    values: {
      action: "BUY",
      canonicalSymbol: "AAPL",
      exchange: "NASDAQ",
      quantity: 1,
      price,
      currency: "USD",
      fee: 0,
      fxRateToCad: 1.35,
      occurredAt: `${date}T12:00:00.000Z`,
    },
  };
}
