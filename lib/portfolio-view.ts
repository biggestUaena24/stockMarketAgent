import {
  applyTransaction,
  createLedger,
  summarizeLedger,
  valuePosition,
  type LedgerState,
  type LedgerTransaction,
} from "./ledger/index";
import type { OwnerSettings } from "./settings";
import type { TransactionRecord } from "./transactions";
import {
  assessPortfolioQuoteFreshness,
  providerDisplayName,
  quoteKeyForHolding,
  type PortfolioMarkFreshness,
  type PortfolioMarkTimePrecision,
  type SavedProviderQuote,
} from "./portfolio-market-quote";

export type PortfolioHoldingView = {
  key: string;
  symbol: string;
  exchange: string;
  currency: "CAD" | "USD";
  quantity: number;
  averageCostNative: number;
  averageCostCad: number;
  costBasisCad: number;
  markedPriceNative: number;
  markedValueCad: number;
  estimatedLiquidationValueCad: number;
  unrealizedGainCad: number;
  unrealizedReturnPctCad: number | null;
  unrealizedReturnPctNative: number | null;
  realizedGainCad: number;
  allocationPct: number;
  lastLedgerPriceAt: string;
  markedPriceAt: string;
  markedPriceTimePrecision: PortfolioMarkTimePrecision;
  markSource: "provider" | "ledger";
  markSourceLabel: string;
  markSourceUrl: string | null;
  markFreshness: PortfolioMarkFreshness;
  markAgeMinutes: number | null;
  markFallbackReason: string | null;
  cadFxRate: number;
  cadFxSourceLabel: string;
  cadFxAt: string;
};

export type PortfolioView = {
  holdings: PortfolioHoldingView[];
  holdingsCount: number;
  markedHoldingsValueCad: number;
  estimatedLiquidationValueCad: number;
  availableCashCad: number;
  totalTrackedCad: number;
  tfsa: LedgerState["tfsa"];
  ledgerCash: LedgerState["cash"];
  totals: ReturnType<typeof summarizeLedger> & {
    explicitFeesCad: number;
  };
  errors: string[];
  valuationLabel: string;
  providerQuoteCount: number;
  freshProviderQuoteCount: number;
  staleProviderQuoteCount: number;
  ledgerFallbackCount: number;
};

export function buildPortfolioView(
  records: TransactionRecord[],
  settings: OwnerSettings,
  savedQuotes: readonly SavedProviderQuote[] = [],
  now = new Date(),
): PortfolioView {
  const ordered = [...records].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  let state = createLedger({
    usdAccountEnabled: settings.usdAccountEnabled,
    wealthsimpleFxFeeRate: 0.015,
    usDividendWithholdingRate: 0.15,
  });
  const errors: string[] = [];
  const latestMarks = new Map<
    string,
    { price: number; fx: number; occurredAt: string }
  >();
  const quotesBySymbol = new Map(
    savedQuotes.map((quote) => [quote.canonicalSymbol, quote]),
  );
  let explicitFeesCad = 0;

  for (const record of ordered) {
    if (record.action === "FEE") {
      explicitFeesCad +=
        record.quantity * record.price * record.fxRateToCad + record.fee;
      continue;
    }
    if (record.action === "FX_CONVERSION") continue;
    const transaction = toLedgerTransaction(record);
    if (!transaction) continue;
    try {
      state = applyTransaction(state, transaction);
      if (record.action === "BUY" || record.action === "SELL") {
        latestMarks.set(securityKey(record), {
          price: record.price,
          fx: record.fxRateToCad,
          occurredAt: record.occurredAt,
        });
      }
    } catch (error) {
      errors.push(
        `${record.canonicalSymbol}: ${
          error instanceof Error ? error.message : "could not be processed"
        }`,
      );
    }
  }

  const provisional = Object.entries(state.positions)
    .filter(([, position]) => position.quantity > 0)
    .map(([key, position]) => {
      const ledgerMark = latestMarks.get(key) ?? {
        price: position.averageCostNative,
        fx:
          position.security.currency === "CAD"
            ? 1
            : position.averageCostCad / Math.max(position.averageCostNative, 0.01),
        occurredAt: ordered.at(-1)?.occurredAt ?? new Date(0).toISOString(),
      };
      const savedQuote = quotesBySymbol.get(
        quoteKeyForHolding(position.security),
      );
      const usableQuote =
        savedQuote?.currency === position.security.currency
          ? savedQuote
          : null;
      const quoteFreshness = usableQuote
        ? assessPortfolioQuoteFreshness(usableQuote, now)
        : null;
      const mark = usableQuote
        ? {
            price: usableQuote.priceNative,
            fx: ledgerMark.fx,
            occurredAt: usableQuote.asOf,
            timePrecision:
              usableQuote.provider === "alpha-vantage"
                ? ("market-date" as const)
                : ("timestamp" as const),
            source: "provider" as const,
            sourceLabel: providerDisplayName(usableQuote.provider),
            sourceUrl: usableQuote.sourceUrl || null,
            freshness: quoteFreshness?.freshness ?? ("stale" as const),
            ageMinutes: quoteFreshness?.ageMinutes ?? null,
            fallbackReason: null,
          }
        : {
            ...ledgerMark,
            timePrecision: "ledger-time" as const,
            source: "ledger" as const,
            sourceLabel: "Ledger price fallback",
            sourceUrl: null,
            freshness: "ledger-fallback" as const,
            ageMinutes: null,
            fallbackReason: savedQuote
              ? `The saved provider quote is ${savedQuote.currency}, but this ledger position is ${position.security.currency}.`
              : "No saved provider quote matched this holding.",
          };
      const valuation = valuePosition(
        position,
        {
          security: position.security,
          priceNative: Math.max(mark.price, 0.000001),
          cadPerNative:
            position.security.currency === "USD" ? mark.fx : undefined,
        },
        state.config,
      );
      return { key, position, mark, ledgerMark, valuation };
    });
  const totalLiquidation = provisional.reduce(
    (sum, item) => sum + item.valuation.estimatedLiquidationValueCad,
    0,
  );
  const holdings = provisional
    .map(({ key, position, mark, ledgerMark, valuation }) => ({
      key,
      symbol: position.security.symbol,
      exchange: position.security.exchange,
      currency: position.security.currency,
      quantity: position.quantity,
      averageCostNative: position.averageCostNative,
      averageCostCad: position.averageCostCad,
      costBasisCad: position.costBasisCad,
      markedPriceNative: mark.price,
      markedValueCad: valuation.marketValueCadAtSpot,
      estimatedLiquidationValueCad: valuation.estimatedLiquidationValueCad,
      unrealizedGainCad: valuation.unrealizedGainCad,
      unrealizedReturnPctCad: valuation.unrealizedReturnPctCad,
      unrealizedReturnPctNative: valuation.unrealizedReturnPctNative,
      realizedGainCad: valuation.realizedGainCad,
      allocationPct:
        totalLiquidation > 0
          ? round((valuation.estimatedLiquidationValueCad / totalLiquidation) * 100)
          : 0,
      lastLedgerPriceAt: ledgerMark.occurredAt,
      markedPriceAt: mark.occurredAt,
      markedPriceTimePrecision: mark.timePrecision,
      markSource: mark.source,
      markSourceLabel: mark.sourceLabel,
      markSourceUrl: mark.sourceUrl,
      markFreshness: mark.freshness,
      markAgeMinutes: mark.ageMinutes,
      markFallbackReason: mark.fallbackReason,
      cadFxRate: position.security.currency === "CAD" ? 1 : ledgerMark.fx,
      cadFxSourceLabel:
        position.security.currency === "CAD"
          ? "CAD base currency"
          : "Latest recorded ledger FX rate",
      cadFxAt: ledgerMark.occurredAt,
    }))
    .sort((left, right) => right.markedValueCad - left.markedValueCad);

  const totals = summarizeLedger(state);
  const markedHoldingsValueCad = round(
    holdings.reduce((sum, holding) => sum + holding.markedValueCad, 0),
  );
  const estimatedLiquidationValueCad = round(
    holdings.reduce(
      (sum, holding) => sum + holding.estimatedLiquidationValueCad,
      0,
    ),
  );
  const providerQuoteCount = holdings.filter(
    (holding) => holding.markSource === "provider",
  ).length;
  const freshProviderQuoteCount = holdings.filter(
    (holding) => holding.markFreshness === "fresh",
  ).length;
  const staleProviderQuoteCount = holdings.filter(
    (holding) => holding.markFreshness === "stale",
  ).length;
  const ledgerFallbackCount = holdings.length - providerQuoteCount;

  return {
    holdings,
    holdingsCount: holdings.length,
    markedHoldingsValueCad,
    estimatedLiquidationValueCad,
    availableCashCad: settings.availableCashCad,
    totalTrackedCad: round(
      estimatedLiquidationValueCad + settings.availableCashCad,
    ),
    tfsa: state.tfsa,
    ledgerCash: state.cash,
    totals: {
      ...totals,
      explicitFeesCad: round(explicitFeesCad),
    },
    errors,
    valuationLabel: valuationLabel(
      holdings.length,
      freshProviderQuoteCount,
      staleProviderQuoteCount,
      ledgerFallbackCount,
    ),
    providerQuoteCount,
    freshProviderQuoteCount,
    staleProviderQuoteCount,
    ledgerFallbackCount,
  };
}

function valuationLabel(
  holdingsCount: number,
  freshProviderQuoteCount: number,
  staleProviderQuoteCount: number,
  ledgerFallbackCount: number,
): string {
  if (holdingsCount === 0) {
    return "No open holdings are available to value.";
  }
  const counts = `${freshProviderQuoteCount} fresh provider ${pluralize("quote", freshProviderQuoteCount)}, ${staleProviderQuoteCount} stale provider ${pluralize("quote", staleProviderQuoteCount)}, and ${ledgerFallbackCount} ledger-price ${pluralize("fallback", ledgerFallbackCount)}`;
  if (staleProviderQuoteCount === 0 && ledgerFallbackCount === 0) {
    return `Estimated from ${counts}. “Fresh” means within the configured provider window, not necessarily live.`;
  }
  return `Estimated from ${counts} across ${holdingsCount} ${pluralize("holding", holdingsCount)}. This is not a fully current market valuation.`;
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function toLedgerTransaction(
  record: TransactionRecord,
): LedgerTransaction | null {
  const amountCad =
    record.quantity * record.price * record.fxRateToCad + record.fee;
  if (record.action === "CONTRIBUTION") {
    return {
      id: record.id,
      occurredAt: record.occurredAt,
      type: "contribution",
      amountCad,
    };
  }
  if (record.action === "WITHDRAWAL") {
    return {
      id: record.id,
      occurredAt: record.occurredAt,
      type: "withdrawal",
      amountCad,
    };
  }
  if (
    record.action !== "BUY" &&
    record.action !== "SELL" &&
    record.action !== "DIVIDEND"
  ) {
    return null;
  }
  const security = {
    symbol: record.canonicalSymbol,
    exchange: record.exchange,
    currency: record.currency,
  } as const;
  if (record.action === "DIVIDEND") {
    return {
      id: record.id,
      occurredAt: record.occurredAt,
      type: "dividend",
      security,
      grossAmountNative: record.quantity * record.price,
      sourceCountry:
        record.exchange === "NYSE" || record.exchange === "NASDAQ"
          ? "US"
          : "CA",
      cadPerNative:
        record.currency === "USD" ? record.fxRateToCad : undefined,
    };
  }
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    type: record.action === "BUY" ? "buy" : "sell",
    security,
    quantity: record.quantity,
    priceNative: record.price,
    feeNative: record.fee,
    cadPerNative:
      record.currency === "USD" ? record.fxRateToCad : undefined,
  };
}

function securityKey(record: TransactionRecord): string {
  return `${record.exchange}:${record.canonicalSymbol}`;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
