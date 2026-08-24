import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLedger,
  estimateDividendReceipt,
  estimateTradeCashFlow,
  securityKey,
  summarizeLedger,
  valuePosition,
} from "../../lib/ledger/index.js";

const cadSecurity = {
  symbol: "SHOP",
  exchange: "TSX",
  currency: "CAD",
} as const;

const usdSecurity = {
  symbol: "MSFT",
  exchange: "NASDAQ",
  currency: "USD",
} as const;

test("uses weighted-average cost through partial CAD buys and sells", () => {
  const ledger = buildLedger([
    {
      id: "buy-1",
      occurredAt: "2026-01-02",
      type: "buy",
      security: cadSecurity,
      quantity: 10,
      priceNative: 10,
      feeNative: 1,
    },
    {
      id: "buy-2",
      occurredAt: "2026-01-03",
      type: "buy",
      security: cadSecurity,
      quantity: 5,
      priceNative: 20,
      feeNative: 1,
    },
    {
      id: "sell-1",
      occurredAt: "2026-02-01",
      type: "sell",
      security: cadSecurity,
      quantity: 6,
      priceNative: 18,
      feeNative: 2,
    },
  ]);

  const position = ledger.positions[securityKey(cadSecurity)];
  assert.equal(position.quantity, 9);
  assert.equal(position.costBasisNative, 121.2);
  assert.equal(position.costBasisCad, 121.2);
  assert.equal(position.averageCostNative, 13.466667);
  assert.equal(position.realizedCostBasisNative, 80.8);
  assert.equal(position.realizedGainNative, 25.2);
  assert.equal(position.realizedGainCad, 25.2);
  assert.equal(position.tradeFeesNative, 4);

  const valuation = valuePosition(
    position,
    { security: cadSecurity, priceNative: 16 },
    ledger.config,
  );
  assert.equal(valuation.marketValueNative, 144);
  assert.equal(valuation.unrealizedGainNative, 22.8);
  assert.equal(valuation.unrealizedGainCad, 22.8);
  assert.equal(valuation.unrealizedReturnPctNative, 18.8119);
  assert.equal(valuation.realizedReturnPctNative, 31.1881);
});

test("models both sides of Wealthsimple's 1.5% USD trade conversion", () => {
  const buy = {
    id: "usd-buy",
    occurredAt: "2026-01-02",
    type: "buy",
    security: usdSecurity,
    quantity: 10,
    priceNative: 100,
    cadPerNative: 1.35,
  } as const;
  const sell = {
    id: "usd-sell",
    occurredAt: "2026-02-01",
    type: "sell",
    security: usdSecurity,
    quantity: 4,
    priceNative: 120,
    cadPerNative: 1.4,
  } as const;

  const buyFlow = estimateTradeCashFlow(buy, {
    usdAccountEnabled: false,
  });
  assert.equal(buyFlow.fxFeeCad, 20.25);
  assert.equal(buyFlow.cashCurrency, "CAD");
  assert.equal(buyFlow.cashDelta, -1370.25);

  const sellFlow = estimateTradeCashFlow(sell, {
    usdAccountEnabled: false,
  });
  assert.equal(sellFlow.fxFeeCad, 10.08);
  assert.equal(sellFlow.cashDelta, 661.92);

  const ledger = buildLedger([buy, sell], { usdAccountEnabled: false });
  const position = ledger.positions[securityKey(usdSecurity)];
  assert.equal(ledger.cash.CAD, -708.33);
  assert.equal(ledger.cash.USD, 0);
  assert.equal(position.quantity, 6);
  assert.equal(position.costBasisNative, 600);
  assert.equal(position.costBasisCad, 822.15);
  assert.equal(position.realizedGainNative, 80);
  assert.equal(position.realizedGainCad, 113.82);
  assert.equal(position.fxFeesCad, 30.33);

  const valuation = valuePosition(
    position,
    {
      security: usdSecurity,
      priceNative: 110,
      cadPerNative: 1.4,
    },
    ledger.config,
  );
  assert.equal(valuation.marketValueNative, 660);
  assert.equal(valuation.marketValueCadAtSpot, 924);
  assert.equal(valuation.estimatedSaleFxFeeCad, 13.86);
  assert.equal(valuation.estimatedLiquidationValueCad, 910.14);
  assert.equal(valuation.unrealizedGainNative, 60);
  assert.equal(valuation.unrealizedGainCad, 87.99);
});

test("opening positions preserve reported basis without cash movement or acquisition fees", () => {
  const ledger = buildLedger(
    [
      {
        id: "opening-1",
        occurredAt: "2026-01-02",
        type: "opening_position",
        security: usdSecurity,
        quantity: 6,
        costBasisNative: 600,
        costBasisCad: 810,
      },
      {
        id: "opening-2",
        occurredAt: "2026-01-02",
        type: "opening_position",
        security: usdSecurity,
        quantity: 4,
        costBasisNative: 400,
        costBasisCad: 540,
      },
      {
        id: "later-sale",
        occurredAt: "2026-02-01",
        type: "sell",
        security: usdSecurity,
        quantity: 4,
        priceNative: 120,
        cadPerNative: 1.4,
      },
    ],
    { usdAccountEnabled: false },
  );

  const position = ledger.positions[securityKey(usdSecurity)];
  assert.deepEqual(ledger.cash, { CAD: 661.92, USD: 0 });
  assert.equal(position.quantity, 6);
  assert.equal(position.costBasisNative, 600);
  assert.equal(position.costBasisCad, 810);
  assert.equal(position.realizedCostBasisNative, 400);
  assert.equal(position.realizedCostBasisCad, 540);
  assert.equal(position.realizedGainNative, 80);
  assert.equal(position.realizedGainCad, 121.92);
  assert.equal(position.tradeFeesCad, 0);
  assert.equal(position.fxFeesCad, 10.08);
});

test("settles USD trades in USD without automatic FX when USD accounts are enabled", () => {
  const ledger = buildLedger(
    [
      {
        id: "usd-buy",
        occurredAt: "2026-01-02",
        type: "buy",
        security: usdSecurity,
        quantity: 2,
        priceNative: 100,
        feeNative: 1,
        cadPerNative: 1.35,
      },
    ],
    { usdAccountEnabled: true },
  );

  const position = ledger.positions[securityKey(usdSecurity)];
  assert.equal(ledger.cash.CAD, 0);
  assert.equal(ledger.cash.USD, -201);
  assert.equal(position.costBasisNative, 201);
  assert.equal(position.costBasisCad, 271.35);
  assert.equal(position.fxFeesCad, 0);
});

test("estimates 15% U.S. dividend withholding without charging cash-dividend FX", () => {
  const dividend = {
    id: "dividend-1",
    occurredAt: "2026-03-15",
    type: "dividend",
    security: usdSecurity,
    grossAmountNative: 100,
    sourceCountry: "US",
    cadPerNative: 1.35,
  } as const;

  const receipt = estimateDividendReceipt(dividend, {
    usdAccountEnabled: false,
  });
  assert.equal(receipt.withholdingRate, 0.15);
  assert.equal(receipt.withholdingEstimated, true);
  assert.equal(receipt.withholdingNative, 15);
  assert.equal(receipt.netNative, 85);
  assert.equal(receipt.withholdingCad, 20.25);
  assert.equal(receipt.netCad, 114.75);
  assert.equal(receipt.cashCurrency, "CAD");
  assert.equal(receipt.cashDelta, 114.75);

  const cadLedger = buildLedger([dividend], {
    usdAccountEnabled: false,
  });
  assert.equal(cadLedger.cash.CAD, 114.75);
  assert.equal(cadLedger.cash.USD, 0);

  const usdLedger = buildLedger([dividend], {
    usdAccountEnabled: true,
  });
  assert.equal(usdLedger.cash.CAD, 0);
  assert.equal(usdLedger.cash.USD, 85);

  const totals = summarizeLedger(cadLedger);
  assert.equal(totals.grossDividendsCad, 135);
  assert.equal(totals.netDividendsCad, 114.75);
  assert.equal(totals.estimatedWithholdingCad, 20.25);
});

test("tracks TFSA contribution and withdrawal flows independently of returns", () => {
  const ledger = buildLedger([
    {
      id: "contribution-2025",
      occurredAt: "2025-12-01",
      type: "contribution",
      amountCad: 1_000,
    },
    {
      id: "contribution-2026",
      occurredAt: "2026-01-02",
      type: "contribution",
      amountCad: 5_000,
    },
    {
      id: "buy",
      occurredAt: "2026-01-03",
      type: "buy",
      security: cadSecurity,
      quantity: 10,
      priceNative: 100,
    },
    {
      id: "dividend",
      occurredAt: "2026-03-01",
      type: "dividend",
      security: cadSecurity,
      grossAmountNative: 50,
      sourceCountry: "CA",
    },
    {
      id: "withdrawal",
      occurredAt: "2026-06-01",
      type: "withdrawal",
      amountCad: 500,
    },
  ]);

  assert.equal(ledger.tfsa.contributionsCad, 6_000);
  assert.equal(ledger.tfsa.withdrawalsCad, 500);
  assert.equal(ledger.tfsa.netCashFlowCad, 5_500);
  assert.deepEqual(ledger.tfsa.contributionsByYearCad, {
    "2025": 1_000,
    "2026": 5_000,
  });
  assert.deepEqual(ledger.tfsa.withdrawalsByYearCad, { "2026": 500 });
  assert.equal(ledger.cash.CAD, 4_550);
});

test("closes a position without leaving rounding residue", () => {
  const ledger = buildLedger([
    {
      id: "buy",
      occurredAt: "2026-01-02",
      type: "buy",
      security: cadSecurity,
      quantity: 3,
      priceNative: 10,
      feeNative: 1,
    },
    {
      id: "partial-sell",
      occurredAt: "2026-02-01",
      type: "sell",
      security: cadSecurity,
      quantity: 1,
      priceNative: 12,
    },
    {
      id: "final-sell",
      occurredAt: "2026-02-02",
      type: "sell",
      security: cadSecurity,
      quantity: 2,
      priceNative: 12,
    },
  ]);

  const position = ledger.positions[securityKey(cadSecurity)];
  assert.equal(position.quantity, 0);
  assert.equal(position.costBasisNative, 0);
  assert.equal(position.costBasisCad, 0);
  assert.equal(position.averageCostNative, 0);
  assert.equal(position.realizedCostBasisNative, 31);
  assert.equal(position.realizedGainNative, 5);
});

test("rejects duplicate transactions and selling more shares than held", () => {
  assert.throws(
    () =>
      buildLedger([
        {
          id: "same",
          occurredAt: "2026-01-02",
          type: "contribution",
          amountCad: 100,
        },
        {
          id: "same",
          occurredAt: "2026-01-03",
          type: "contribution",
          amountCad: 100,
        },
      ]),
    /Duplicate transaction id/,
  );

  assert.throws(
    () =>
      buildLedger([
        {
          id: "buy",
          occurredAt: "2026-01-02",
          type: "buy",
          security: cadSecurity,
          quantity: 1,
          priceNative: 10,
        },
        {
          id: "sell",
          occurredAt: "2026-01-03",
          type: "sell",
          security: cadSecurity,
          quantity: 2,
          priceNative: 10,
        },
      ]),
    /only 1 are held/,
  );
});
