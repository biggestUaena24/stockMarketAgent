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
};

export function buildPortfolioView(
  records: TransactionRecord[],
  settings: OwnerSettings,
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
      const mark = latestMarks.get(key) ?? {
        price: position.averageCostNative,
        fx:
          position.security.currency === "CAD"
            ? 1
            : position.averageCostCad / Math.max(position.averageCostNative, 0.01),
        occurredAt: ordered.at(-1)?.occurredAt ?? new Date(0).toISOString(),
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
      return { key, position, mark, valuation };
    });
  const totalLiquidation = provisional.reduce(
    (sum, item) => sum + item.valuation.estimatedLiquidationValueCad,
    0,
  );
  const holdings = provisional
    .map(({ key, position, mark, valuation }) => ({
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
      lastLedgerPriceAt: mark.occurredAt,
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
    valuationLabel:
      "Uses the latest price recorded in your ledger—not a current market quote.",
  };
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
