import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPortfolioQuoteFreshness,
  parseSavedProviderQuote,
  quoteKeyForHolding,
  type SavedProviderQuote,
} from "../../lib/portfolio-market-quote.js";
import { buildPortfolioView } from "../../lib/portfolio-view.js";
import type { OwnerSettings } from "../../lib/settings.js";
import type { TransactionRecord } from "../../lib/transactions.js";

const now = new Date("2026-08-24T16:00:00.000Z");

const settings: OwnerSettings = {
  ownerEmail: "owner@example.test",
  onboardingComplete: true,
  horizonYears: 5,
  lossTolerancePct: 20,
  emergencyFundConfirmed: true,
  usdAccountEnabled: false,
  tfsaRoomEstimateCad: 7_000,
  tfsaAnnualLimitCad: 7_000,
  availableCashCad: 500,
  exclusions: [],
  watchlist: [],
  etfCoreTargetPct: 90,
  individualStocksMaxPct: 10,
  singleStockMaxPct: 3,
  providerMode: "trial",
  quoteEntitlementVerified: false,
  liveLabelsAcknowledged: false,
  ledgerReconciledAt: "2026-08-20T00:00:00.000Z",
  paperTrialStartedAt: null,
  updatedAt: "2026-08-20T00:00:00.000Z",
};

test("values a CAD holding with the latest saved provider quote", () => {
  const portfolio = buildPortfolioView(
    [buy("shop-buy", "SHOP", "TSX", "CAD", 10, 100, 1)],
    settings,
    [quote("SHOP.TO", 125, "CAD", "2026-08-24T00:00:00.000Z")],
    now,
  );

  const holding = portfolio.holdings[0];
  assert.ok(holding);
  assert.equal(holding.markedPriceNative, 125);
  assert.equal(holding.markedValueCad, 1_250);
  assert.equal(holding.estimatedLiquidationValueCad, 1_250);
  assert.equal(holding.unrealizedGainCad, 250);
  assert.equal(holding.unrealizedReturnPctNative, 25);
  assert.equal(holding.unrealizedReturnPctCad, 25);
  assert.equal(holding.markSource, "provider");
  assert.equal(holding.markSourceLabel, "Alpha Vantage");
  assert.equal(holding.markSourceUrl, "https://www.alphavantage.co/query");
  assert.equal(holding.markedPriceAt, "2026-08-24T00:00:00.000Z");
  assert.equal(holding.markedPriceTimePrecision, "market-date");
  assert.equal(holding.lastLedgerPriceAt, "2026-08-01T15:30:00.000Z");
  assert.equal(holding.markFreshness, "fresh");
  assert.equal(portfolio.providerQuoteCount, 1);
  assert.equal(portfolio.freshProviderQuoteCount, 1);
  assert.equal(portfolio.staleProviderQuoteCount, 0);
  assert.equal(portfolio.ledgerFallbackCount, 0);
  assert.match(portfolio.valuationLabel, /1 fresh provider quote/);
  assert.match(portfolio.valuationLabel, /not necessarily live/);
});

test("uses a provider's native USD price with the deterministic ledger FX rate", () => {
  const portfolio = buildPortfolioView(
    [buy("msft-buy", "MSFT", "NASDAQ", "USD", 2, 100, 1.3)],
    settings,
    [
      quote(
        "MSFT",
        110,
        "USD",
        "2026-08-24T15:50:00.000Z",
        "fmp",
      ),
    ],
    now,
  );

  const holding = portfolio.holdings[0];
  assert.ok(holding);
  assert.equal(holding.markSource, "provider");
  assert.equal(holding.markedPriceTimePrecision, "timestamp");
  assert.equal(holding.markedPriceNative, 110);
  assert.equal(holding.markedValueCad, 286);
  assert.equal(holding.unrealizedReturnPctNative, 10);
  assert.equal(holding.cadFxRate, 1.3);
  assert.equal(holding.cadFxSourceLabel, "Latest recorded ledger FX rate");
  assert.equal(holding.cadFxAt, "2026-08-01T15:30:00.000Z");
  assert.equal(holding.markFreshness, "fresh");
});

test("falls back explicitly to the ledger price when no compatible quote exists", () => {
  const portfolio = buildPortfolioView(
    [buy("shop-buy", "SHOP", "TSX", "CAD", 10, 100, 1)],
    settings,
    [quote("SHOP.TO", 125, "USD", "2026-08-24T00:00:00.000Z")],
    now,
  );

  const holding = portfolio.holdings[0];
  assert.ok(holding);
  assert.equal(holding.markedPriceNative, 100);
  assert.equal(holding.markSource, "ledger");
  assert.equal(holding.markedPriceTimePrecision, "ledger-time");
  assert.equal(holding.markFreshness, "ledger-fallback");
  assert.match(holding.markFallbackReason ?? "", /quote is USD.*position is CAD/);
  assert.equal(portfolio.providerQuoteCount, 0);
  assert.equal(portfolio.freshProviderQuoteCount, 0);
  assert.equal(portfolio.staleProviderQuoteCount, 0);
  assert.equal(portfolio.ledgerFallbackCount, 1);
  assert.match(portfolio.valuationLabel, /1 ledger-price fallback/);
  assert.match(portfolio.valuationLabel, /not a fully current market valuation/);
});

test("aggregate valuation separates fresh, stale, and ledger fallback marks", () => {
  const portfolio = buildPortfolioView(
    [
      buy("shop-buy", "SHOP", "TSX", "CAD", 10, 100, 1),
      buy("ry-buy", "RY", "TSX", "CAD", 4, 120, 1),
      buy("msft-buy", "MSFT", "NASDAQ", "USD", 2, 100, 1.3),
    ],
    settings,
    [
      quote("SHOP.TO", 125, "CAD", "2026-08-24T00:00:00.000Z"),
      quote("RY.TO", 130, "CAD", "2026-08-20T00:00:00.000Z"),
    ],
    now,
  );

  assert.equal(portfolio.providerQuoteCount, 2);
  assert.equal(portfolio.freshProviderQuoteCount, 1);
  assert.equal(portfolio.staleProviderQuoteCount, 1);
  assert.equal(portfolio.ledgerFallbackCount, 1);
  assert.match(portfolio.valuationLabel, /1 fresh provider quote/);
  assert.match(portfolio.valuationLabel, /1 stale provider quote/);
  assert.match(portfolio.valuationLabel, /1 ledger-price fallback/);
  assert.match(portfolio.valuationLabel, /not a fully current market valuation/);
});

test("parses only app-generated, timestamped provider quote facts", () => {
  const parsed = parseSavedProviderQuote({
    canonicalSymbol: "shop.to",
    factsJson: JSON.stringify([
      "The recorded provider price is 125.75 CAD.",
      "The recorded previous close is 124.20.",
    ]),
    marketDataTime: "2026-08-24T00:00:00.000Z",
    createdAt: "2026-08-24T16:01:00.000Z",
    provider: "alpha-vantage",
    sourceUrl: "https://www.alphavantage.co/query",
    freshness: "miss",
  });
  assert.deepEqual(parsed, {
    canonicalSymbol: "SHOP.TO",
    priceNative: 125.75,
    currency: "CAD",
    asOf: "2026-08-24T00:00:00.000Z",
    savedAt: "2026-08-24T16:01:00.000Z",
    provider: "alpha-vantage",
    sourceUrl: "https://www.alphavantage.co/query",
    cacheState: "miss",
  });
  assert.equal(
    parseSavedProviderQuote({
      canonicalSymbol: "SHOP.TO",
      factsJson: JSON.stringify(["An article says the price is 999 CAD."]),
      marketDataTime: "2026-08-24T00:00:00.000Z",
      createdAt: "2026-08-24T16:01:00.000Z",
      provider: "unknown",
      sourceUrl: "https://example.test",
      freshness: "miss",
    }),
    null,
  );
});

test("marks expired or stale-fallback provider observations as stale", () => {
  const oldQuote = quote("SHOP.TO", 125, "CAD", "2026-08-20T00:00:00.000Z");
  assert.equal(assessPortfolioQuoteFreshness(oldQuote, now).freshness, "stale");
  assert.equal(
    assessPortfolioQuoteFreshness(
      { ...quote("MSFT", 110, "USD", "2026-08-24T15:59:00.000Z", "fmp"), cacheState: "stale-fallback" },
      now,
    ).freshness,
    "stale",
  );
  assert.equal(quoteKeyForHolding({ symbol: "RY", exchange: "TSX" }), "RY.TO");
  assert.equal(quoteKeyForHolding({ symbol: "MSFT", exchange: "NASDAQ" }), "MSFT");
});

function buy(
  id: string,
  canonicalSymbol: string,
  exchange: string,
  currency: "CAD" | "USD",
  quantity: number,
  price: number,
  fxRateToCad: number,
): TransactionRecord {
  return {
    id,
    action: "BUY",
    canonicalSymbol,
    exchange,
    quantity,
    price,
    currency,
    fee: 0,
    fxRateToCad,
    occurredAt: "2026-08-01T15:30:00.000Z",
    importId: null,
    importRowHash: null,
    notes: "",
    createdAt: "2026-08-01T15:31:00.000Z",
    updatedAt: "2026-08-01T15:31:00.000Z",
  };
}

function quote(
  canonicalSymbol: string,
  priceNative: number,
  currency: "CAD" | "USD",
  asOf: string,
  provider = "alpha-vantage",
): SavedProviderQuote {
  return {
    canonicalSymbol,
    priceNative,
    currency,
    asOf,
    savedAt: "2026-08-24T16:01:00.000Z",
    provider,
    sourceUrl:
      provider === "fmp"
        ? "https://financialmodelingprep.com/stable/quote"
        : "https://www.alphavantage.co/query",
    cacheState: "miss",
  };
}
