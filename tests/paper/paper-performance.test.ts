import assert from "node:assert/strict";
import test from "node:test";

import { calculatePaperPerformance } from "../../lib/paper-performance";

const trades = [
  {
    id: "candidate",
    status: "filled",
    action: "consider-candidate",
    quantity: 2,
    decisionTime: "2026-06-01T14:00:00.000Z",
    hypotheticalFillTime: "2026-06-02T14:00:00.000Z",
    hypotheticalFillPrice: 100,
    fxRateToCad: 1,
    feesCad: 2,
  },
  {
    id: "exit",
    status: "filled",
    action: "exit-candidate",
    quantity: 1,
    decisionTime: "2026-06-01T14:00:00.000Z",
    hypotheticalFillTime: "2026-06-02T14:00:00.000Z",
    hypotheticalFillPrice: 50,
    fxRateToCad: 1,
    feesCad: 1,
  },
  {
    id: "waiting",
    status: "queued",
    action: "consider-candidate",
    quantity: 1,
    decisionTime: "2026-06-03T14:00:00.000Z",
    hypotheticalFillTime: null,
    hypotheticalFillPrice: null,
    fxRateToCad: 1,
    feesCad: 0,
  },
];

const marks = [
  {
    paperTradeId: "candidate",
    observedAt: "2026-06-03T14:00:00.000Z",
    price: 110,
    fxRateToCad: 1,
  },
  {
    paperTradeId: "candidate",
    observedAt: "2026-06-04T14:00:00.000Z",
    price: 105,
    fxRateToCad: 1,
  },
  {
    paperTradeId: "exit",
    observedAt: "2026-06-04T14:00:00.000Z",
    price: 45,
    fxRateToCad: 1,
  },
];

const benchmark = [
  {
    observedAt: "2026-06-03T14:00:00.000Z",
    price: 25,
    fxRateToCad: 1,
  },
  {
    observedAt: "2026-06-04T14:00:00.000Z",
    price: 25.5,
    fxRateToCad: 1,
  },
];

test("computes after-fee CAD outcomes for candidate and exit labels", () => {
  const result = calculatePaperPerformance(trades, marks, benchmark);
  assert.equal(result.metrics.totalDecisions, 3);
  assert.equal(result.metrics.queuedFills, 1);
  assert.equal(result.metrics.filledDecisions, 2);
  assert.equal(result.metrics.markedDecisions, 2);
  assert.equal(result.metrics.capitalTrackedCad, 250);
  assert.equal(result.metrics.turnoverCad, 250);
  assert.equal(result.metrics.afterFeeProfitCad, 12);
  assert.equal(result.metrics.afterFeeReturnPct, 4.8);
  assert.equal(result.metrics.estimatedFxCostsCad, 3);

  const candidate = result.outcomes.find(
    (outcome) => outcome.paperTradeId === "candidate",
  );
  const exit = result.outcomes.find(
    (outcome) => outcome.paperTradeId === "exit",
  );
  assert.equal(candidate?.afterFeeProfitCad, 8);
  assert.equal(candidate?.afterFeeReturnPct, 4);
  assert.equal(exit?.afterFeeProfitCad, 4);
  assert.equal(exit?.afterFeeReturnPct, 8);
});

test("uses the first benchmark mark after fill and reports drawdown", () => {
  const result = calculatePaperPerformance(trades, marks, benchmark);
  assert.equal(result.outcomes[0]?.benchmarkReturnPct, 2);
  assert.equal(result.metrics.benchmarkReturnPct, 1.2);
  assert.equal(result.metrics.excessReturnPct, 3.6);
  assert.ok((result.metrics.maxDrawdownPct ?? 0) < 0);
});

test("does not invent returns before a later mark exists", () => {
  const result = calculatePaperPerformance([trades[2]], [], []);
  assert.equal(result.metrics.afterFeeReturnPct, null);
  assert.equal(result.metrics.benchmarkReturnPct, null);
  assert.equal(result.metrics.maxDrawdownPct, null);
  assert.deepEqual(result.outcomes, []);
});
