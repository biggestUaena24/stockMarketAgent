import type {
  DividendReceipt,
  DividendTransaction,
  LedgerConfig,
  LedgerState,
  LedgerTotals,
  LedgerTransaction,
  MarketQuote,
  Position,
  PositionValuation,
  ResolvedLedgerConfig,
  Security,
  TradeCashFlow,
  TradeTransaction,
} from "./types.js";

const MONEY_PRECISION = 2;
const QUANTITY_PRECISION = 8;
const UNIT_PRECISION = 6;
const PERCENT_PRECISION = 4;
const QUANTITY_EPSILON = 1e-8;

export const DEFAULT_LEDGER_CONFIG: Readonly<ResolvedLedgerConfig> = {
  usdAccountEnabled: false,
  wealthsimpleFxFeeRate: 0.015,
  usDividendWithholdingRate: 0.15,
};

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  const adjusted =
    value === 0 ? value : value + Number.EPSILON * Math.sign(value);
  return Math.round(adjusted * factor) / factor;
}

export function roundMoney(value: number): number {
  return round(value, MONEY_PRECISION);
}

function roundQuantity(value: number): number {
  return round(value, QUANTITY_PRECISION);
}

function roundUnit(value: number): number {
  return round(value, UNIT_PRECISION);
}

function roundPercent(value: number): number {
  return round(value, PERCENT_PRECISION);
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) {
    throw new RangeError(`${name} cannot be negative`);
  }
}

function assertRate(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0 || value >= 1) {
    throw new RangeError(`${name} must be at least 0 and less than 1`);
  }
}

function resolveConfig(config: LedgerConfig = {}): ResolvedLedgerConfig {
  const resolved: ResolvedLedgerConfig = {
    usdAccountEnabled:
      config.usdAccountEnabled ?? DEFAULT_LEDGER_CONFIG.usdAccountEnabled,
    wealthsimpleFxFeeRate:
      config.wealthsimpleFxFeeRate ??
      DEFAULT_LEDGER_CONFIG.wealthsimpleFxFeeRate,
    usDividendWithholdingRate:
      config.usDividendWithholdingRate ??
      DEFAULT_LEDGER_CONFIG.usDividendWithholdingRate,
  };

  assertRate("wealthsimpleFxFeeRate", resolved.wealthsimpleFxFeeRate);
  assertRate(
    "usDividendWithholdingRate",
    resolved.usDividendWithholdingRate,
  );

  return resolved;
}

function normalizeSecurity(security: Security): Security {
  const symbol = security.symbol.trim().toUpperCase();
  const exchange = security.exchange.trim().toUpperCase();

  if (!symbol) {
    throw new TypeError("security.symbol cannot be empty");
  }
  if (!exchange) {
    throw new TypeError("security.exchange cannot be empty");
  }
  if (security.currency !== "CAD" && security.currency !== "USD") {
    throw new TypeError("security.currency must be CAD or USD");
  }

  return { symbol, exchange, currency: security.currency };
}

export function securityKey(security: Security): string {
  const normalized = normalizeSecurity(security);
  return `${normalized.exchange}:${normalized.symbol}`;
}

function cadPerNative(
  security: Security,
  providedRate: number | undefined,
): number {
  if (security.currency === "CAD") {
    return 1;
  }

  if (providedRate === undefined) {
    throw new TypeError("cadPerNative is required for USD securities");
  }
  assertPositive("cadPerNative", providedRate);
  return providedRate;
}

function emptyPosition(security: Security): Position {
  return {
    security,
    quantity: 0,
    costBasisNative: 0,
    costBasisCad: 0,
    averageCostNative: 0,
    averageCostCad: 0,
    realizedCostBasisNative: 0,
    realizedCostBasisCad: 0,
    realizedGainNative: 0,
    realizedGainCad: 0,
    grossDividendsNative: 0,
    grossDividendsCad: 0,
    netDividendsNative: 0,
    netDividendsCad: 0,
    estimatedWithholdingNative: 0,
    estimatedWithholdingCad: 0,
    tradeFeesNative: 0,
    tradeFeesCad: 0,
    fxFeesCad: 0,
  };
}

function assertPositionCurrency(
  position: Position,
  security: Security,
): void {
  if (position.security.currency !== security.currency) {
    throw new TypeError(
      `${securityKey(security)} is already recorded in ${position.security.currency}, not ${security.currency}`,
    );
  }
}

function withAverageCosts(position: Position): Position {
  if (position.quantity <= QUANTITY_EPSILON) {
    return {
      ...position,
      quantity: 0,
      costBasisNative: 0,
      costBasisCad: 0,
      averageCostNative: 0,
      averageCostCad: 0,
    };
  }

  return {
    ...position,
    averageCostNative: roundUnit(
      position.costBasisNative / position.quantity,
    ),
    averageCostCad: roundUnit(position.costBasisCad / position.quantity),
  };
}

function transactionYear(occurredAt: string): string {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(occurredAt);
  if (!match) {
    throw new TypeError(
      "occurredAt must begin with an ISO calendar date (YYYY-MM-DD)",
    );
  }
  return match[1];
}

function assertTransactionIdentity(
  state: LedgerState,
  transaction: LedgerTransaction,
): void {
  if (!transaction.id.trim()) {
    throw new TypeError("transaction.id cannot be empty");
  }
  if (state.processedTransactionIds.includes(transaction.id)) {
    throw new Error(`Duplicate transaction id: ${transaction.id}`);
  }
  transactionYear(transaction.occurredAt);
}

export function createLedger(config: LedgerConfig = {}): LedgerState {
  return {
    config: resolveConfig(config),
    cash: { CAD: 0, USD: 0 },
    positions: {},
    tfsa: {
      contributionsCad: 0,
      withdrawalsCad: 0,
      netCashFlowCad: 0,
      contributionsByYearCad: {},
      withdrawalsByYearCad: {},
    },
    processedTransactionIds: [],
  };
}

export function estimateTradeCashFlow(
  transaction: TradeTransaction,
  config: LedgerConfig | ResolvedLedgerConfig = {},
): TradeCashFlow {
  const resolved = resolveConfig(config);
  const security = normalizeSecurity(transaction.security);
  assertPositive("quantity", transaction.quantity);
  assertPositive("priceNative", transaction.priceNative);

  const unroundedFeeNative = transaction.feeNative ?? 0;
  assertNonNegative("feeNative", unroundedFeeNative);
  const feeNative = roundMoney(unroundedFeeNative);

  const grossNative = roundMoney(
    transaction.quantity * transaction.priceNative,
  );
  assertPositive("rounded gross trade amount", grossNative);
  const nativeCashAmount = roundMoney(
    transaction.type === "buy"
      ? grossNative + feeNative
      : grossNative - feeNative,
  );

  if (transaction.type === "sell" && nativeCashAmount < 0) {
    throw new RangeError("feeNative cannot exceed gross sale proceeds");
  }

  const rate = cadPerNative(security, transaction.cadPerNative);
  const requiresAutomaticFx =
    security.currency === "USD" && !resolved.usdAccountEnabled;
  const fxFeeRate = requiresAutomaticFx
    ? resolved.wealthsimpleFxFeeRate
    : 0;
  const valueCadBeforeFx = roundMoney(nativeCashAmount * rate);
  const fxFeeCad = roundMoney(valueCadBeforeFx * fxFeeRate);
  const direction = transaction.type === "buy" ? -1 : 1;
  const cadEquivalentDelta = roundMoney(
    direction *
      (transaction.type === "buy"
        ? valueCadBeforeFx + fxFeeCad
        : valueCadBeforeFx - fxFeeCad),
  );
  const cashCurrency =
    security.currency === "USD" && resolved.usdAccountEnabled ? "USD" : "CAD";
  const cashDelta =
    cashCurrency === "USD"
      ? roundMoney(direction * nativeCashAmount)
      : cadEquivalentDelta;

  return {
    side: transaction.type,
    grossNative,
    feeNative,
    nativeCashAmount,
    cadPerNative: rate,
    fxFeeRate,
    fxFeeCad,
    cashCurrency,
    cashDelta,
    cadEquivalentDelta,
  };
}

export function estimateDividendReceipt(
  transaction: DividendTransaction,
  config: LedgerConfig | ResolvedLedgerConfig = {},
): DividendReceipt {
  const resolved = resolveConfig(config);
  const security = normalizeSecurity(transaction.security);
  assertPositive("grossAmountNative", transaction.grossAmountNative);

  const rate = cadPerNative(security, transaction.cadPerNative);
  const withholdingEstimated =
    transaction.sourceCountry === "US" &&
    transaction.withholdingRate === undefined;
  const withholdingRate =
    transaction.withholdingRate ??
    (transaction.sourceCountry === "US"
      ? resolved.usDividendWithholdingRate
      : 0);
  assertRate("withholdingRate", withholdingRate);

  const grossNative = roundMoney(transaction.grossAmountNative);
  assertPositive("rounded gross dividend amount", grossNative);
  const withholdingNative = roundMoney(grossNative * withholdingRate);
  const netNative = roundMoney(grossNative - withholdingNative);
  const grossCad = roundMoney(grossNative * rate);
  const withholdingCad = roundMoney(withholdingNative * rate);
  const netCad = roundMoney(netNative * rate);
  const cashCurrency =
    security.currency === "USD" && resolved.usdAccountEnabled ? "USD" : "CAD";

  return {
    grossNative,
    grossCad,
    withholdingRate,
    withholdingEstimated,
    withholdingNative,
    withholdingCad,
    netNative,
    netCad,
    cashCurrency,
    // Ordinary cash dividends are not modeled as FX-fee-bearing orders.
    cashDelta: cashCurrency === "USD" ? netNative : netCad,
  };
}

function applyContributionOrWithdrawal(
  state: LedgerState,
  transaction:
    | Extract<LedgerTransaction, { type: "contribution" }>
    | Extract<LedgerTransaction, { type: "withdrawal" }>,
): LedgerState {
  assertPositive("amountCad", transaction.amountCad);
  const amountCad = roundMoney(transaction.amountCad);
  assertPositive("rounded amountCad", amountCad);
  const year = transactionYear(transaction.occurredAt);
  const isContribution = transaction.type === "contribution";
  const signedCash = isContribution ? amountCad : -amountCad;
  const contributionsCad = roundMoney(
    state.tfsa.contributionsCad + (isContribution ? amountCad : 0),
  );
  const withdrawalsCad = roundMoney(
    state.tfsa.withdrawalsCad + (isContribution ? 0 : amountCad),
  );
  const flowByYear = isContribution
    ? state.tfsa.contributionsByYearCad
    : state.tfsa.withdrawalsByYearCad;
  const updatedFlowByYear = {
    ...flowByYear,
    [year]: roundMoney((flowByYear[year] ?? 0) + amountCad),
  };

  return {
    ...state,
    cash: {
      ...state.cash,
      CAD: roundMoney(state.cash.CAD + signedCash),
    },
    tfsa: {
      contributionsCad,
      withdrawalsCad,
      netCashFlowCad: roundMoney(contributionsCad - withdrawalsCad),
      contributionsByYearCad: isContribution
        ? updatedFlowByYear
        : state.tfsa.contributionsByYearCad,
      withdrawalsByYearCad: isContribution
        ? state.tfsa.withdrawalsByYearCad
        : updatedFlowByYear,
    },
  };
}

function applyOpeningPosition(
  state: LedgerState,
  transaction: Extract<LedgerTransaction, { type: "opening_position" }>,
): LedgerState {
  assertPositive("quantity", transaction.quantity);
  assertPositive("costBasisNative", transaction.costBasisNative);
  assertPositive("costBasisCad", transaction.costBasisCad);

  const security = normalizeSecurity(transaction.security);
  const key = securityKey(security);
  const current = state.positions[key] ?? emptyPosition(security);
  assertPositionCurrency(current, security);
  const position = withAverageCosts({
    ...current,
    quantity: roundQuantity(current.quantity + transaction.quantity),
    costBasisNative: roundMoney(
      current.costBasisNative + transaction.costBasisNative,
    ),
    costBasisCad: roundMoney(current.costBasisCad + transaction.costBasisCad),
  });

  return {
    ...state,
    positions: { ...state.positions, [key]: position },
  };
}

function applyBuy(
  state: LedgerState,
  transaction: Extract<LedgerTransaction, { type: "buy" }>,
): LedgerState {
  const flow = estimateTradeCashFlow(transaction, state.config);
  const security = normalizeSecurity(transaction.security);
  const key = securityKey(security);
  const current = state.positions[key] ?? emptyPosition(security);
  assertPositionCurrency(current, security);
  const quantity = roundQuantity(current.quantity + transaction.quantity);
  const costBasisNative = roundMoney(
    current.costBasisNative + flow.nativeCashAmount,
  );
  const buyCostCad = roundMoney(-flow.cadEquivalentDelta);
  const costBasisCad = roundMoney(current.costBasisCad + buyCostCad);
  const position = withAverageCosts({
    ...current,
    quantity,
    costBasisNative,
    costBasisCad,
    tradeFeesNative: roundMoney(
      current.tradeFeesNative + flow.feeNative,
    ),
    tradeFeesCad: roundMoney(
      current.tradeFeesCad + flow.feeNative * flow.cadPerNative,
    ),
    fxFeesCad: roundMoney(current.fxFeesCad + flow.fxFeeCad),
  });

  return {
    ...state,
    cash: {
      ...state.cash,
      [flow.cashCurrency]: roundMoney(
        state.cash[flow.cashCurrency] + flow.cashDelta,
      ),
    },
    positions: { ...state.positions, [key]: position },
  };
}

function applySell(
  state: LedgerState,
  transaction: Extract<LedgerTransaction, { type: "sell" }>,
): LedgerState {
  const security = normalizeSecurity(transaction.security);
  const key = securityKey(security);
  const current = state.positions[key];

  if (!current) {
    throw new RangeError(`Cannot sell ${key}: no position exists`);
  }
  assertPositionCurrency(current, security);
  if (transaction.quantity - current.quantity > QUANTITY_EPSILON) {
    throw new RangeError(
      `Cannot sell ${transaction.quantity} shares of ${key}; only ${current.quantity} are held`,
    );
  }

  const flow = estimateTradeCashFlow(transaction, state.config);
  const isFullSale =
    Math.abs(transaction.quantity - current.quantity) <= QUANTITY_EPSILON;
  const soldFraction = transaction.quantity / current.quantity;
  const allocatedBasisNative = isFullSale
    ? current.costBasisNative
    : roundMoney(current.costBasisNative * soldFraction);
  const allocatedBasisCad = isFullSale
    ? current.costBasisCad
    : roundMoney(current.costBasisCad * soldFraction);
  const realizedGainNative = roundMoney(
    flow.nativeCashAmount - allocatedBasisNative,
  );
  const realizedGainCad = roundMoney(
    flow.cadEquivalentDelta - allocatedBasisCad,
  );
  const position = withAverageCosts({
    ...current,
    quantity: isFullSale
      ? 0
      : roundQuantity(current.quantity - transaction.quantity),
    costBasisNative: isFullSale
      ? 0
      : roundMoney(current.costBasisNative - allocatedBasisNative),
    costBasisCad: isFullSale
      ? 0
      : roundMoney(current.costBasisCad - allocatedBasisCad),
    realizedCostBasisNative: roundMoney(
      current.realizedCostBasisNative + allocatedBasisNative,
    ),
    realizedCostBasisCad: roundMoney(
      current.realizedCostBasisCad + allocatedBasisCad,
    ),
    realizedGainNative: roundMoney(
      current.realizedGainNative + realizedGainNative,
    ),
    realizedGainCad: roundMoney(
      current.realizedGainCad + realizedGainCad,
    ),
    tradeFeesNative: roundMoney(
      current.tradeFeesNative + flow.feeNative,
    ),
    tradeFeesCad: roundMoney(
      current.tradeFeesCad + flow.feeNative * flow.cadPerNative,
    ),
    fxFeesCad: roundMoney(current.fxFeesCad + flow.fxFeeCad),
  });

  return {
    ...state,
    cash: {
      ...state.cash,
      [flow.cashCurrency]: roundMoney(
        state.cash[flow.cashCurrency] + flow.cashDelta,
      ),
    },
    positions: { ...state.positions, [key]: position },
  };
}

function applyDividend(
  state: LedgerState,
  transaction: Extract<LedgerTransaction, { type: "dividend" }>,
): LedgerState {
  const receipt = estimateDividendReceipt(transaction, state.config);
  const security = normalizeSecurity(transaction.security);
  const key = securityKey(security);
  const current = state.positions[key] ?? emptyPosition(security);
  assertPositionCurrency(current, security);
  const position: Position = {
    ...current,
    grossDividendsNative: roundMoney(
      current.grossDividendsNative + receipt.grossNative,
    ),
    grossDividendsCad: roundMoney(
      current.grossDividendsCad + receipt.grossCad,
    ),
    netDividendsNative: roundMoney(
      current.netDividendsNative + receipt.netNative,
    ),
    netDividendsCad: roundMoney(
      current.netDividendsCad + receipt.netCad,
    ),
    estimatedWithholdingNative: roundMoney(
      current.estimatedWithholdingNative + receipt.withholdingNative,
    ),
    estimatedWithholdingCad: roundMoney(
      current.estimatedWithholdingCad + receipt.withholdingCad,
    ),
  };

  return {
    ...state,
    cash: {
      ...state.cash,
      [receipt.cashCurrency]: roundMoney(
        state.cash[receipt.cashCurrency] + receipt.cashDelta,
      ),
    },
    positions: { ...state.positions, [key]: position },
  };
}

export function applyTransaction(
  state: LedgerState,
  transaction: LedgerTransaction,
): LedgerState {
  assertTransactionIdentity(state, transaction);

  let next: LedgerState;
  switch (transaction.type) {
    case "contribution":
    case "withdrawal":
      next = applyContributionOrWithdrawal(state, transaction);
      break;
    case "opening_position":
      next = applyOpeningPosition(state, transaction);
      break;
    case "buy":
      next = applyBuy(state, transaction);
      break;
    case "sell":
      next = applySell(state, transaction);
      break;
    case "dividend":
      next = applyDividend(state, transaction);
      break;
  }

  return {
    ...next,
    processedTransactionIds: [
      ...state.processedTransactionIds,
      transaction.id,
    ],
  };
}

export function buildLedger(
  transactions: readonly LedgerTransaction[],
  config: LedgerConfig = {},
): LedgerState {
  return transactions.reduce(applyTransaction, createLedger(config));
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : roundPercent((numerator / denominator) * 100);
}

export function valuePosition(
  position: Position,
  quote: MarketQuote,
  config: LedgerConfig | ResolvedLedgerConfig = {},
): PositionValuation {
  const resolved = resolveConfig(config);
  const positionKey = securityKey(position.security);
  const quoteKey = securityKey(quote.security);
  if (positionKey !== quoteKey) {
    throw new TypeError(
      `Quote ${quoteKey} does not match position ${positionKey}`,
    );
  }
  if (position.security.currency !== quote.security.currency) {
    throw new TypeError("Quote currency does not match position currency");
  }
  assertPositive("priceNative", quote.priceNative);

  const rate = cadPerNative(position.security, quote.cadPerNative);
  const marketValueNative = roundMoney(position.quantity * quote.priceNative);
  const marketValueCadAtSpot = roundMoney(marketValueNative * rate);
  const estimatedSaleFxFeeCad =
    position.security.currency === "USD" && !resolved.usdAccountEnabled
      ? roundMoney(
          marketValueCadAtSpot * resolved.wealthsimpleFxFeeRate,
        )
      : 0;
  const estimatedLiquidationValueCad = roundMoney(
    marketValueCadAtSpot - estimatedSaleFxFeeCad,
  );
  const unrealizedGainNative = roundMoney(
    marketValueNative - position.costBasisNative,
  );
  const unrealizedGainCad = roundMoney(
    estimatedLiquidationValueCad - position.costBasisCad,
  );
  const totalCapitalNative = roundMoney(
    position.costBasisNative + position.realizedCostBasisNative,
  );
  const totalCapitalCad = roundMoney(
    position.costBasisCad + position.realizedCostBasisCad,
  );
  const totalGainNative = roundMoney(
    unrealizedGainNative +
      position.realizedGainNative +
      position.netDividendsNative,
  );
  const totalGainCad = roundMoney(
    unrealizedGainCad +
      position.realizedGainCad +
      position.netDividendsCad,
  );

  return {
    security: position.security,
    quantity: position.quantity,
    marketValueNative,
    marketValueCadAtSpot,
    estimatedSaleFxFeeCad,
    estimatedLiquidationValueCad,
    unrealizedGainNative,
    unrealizedGainCad,
    unrealizedReturnPctNative: percentage(
      unrealizedGainNative,
      position.costBasisNative,
    ),
    unrealizedReturnPctCad: percentage(
      unrealizedGainCad,
      position.costBasisCad,
    ),
    realizedGainNative: position.realizedGainNative,
    realizedGainCad: position.realizedGainCad,
    realizedReturnPctNative: percentage(
      position.realizedGainNative,
      position.realizedCostBasisNative,
    ),
    realizedReturnPctCad: percentage(
      position.realizedGainCad,
      position.realizedCostBasisCad,
    ),
    totalGainNative,
    totalGainCad,
    totalReturnPctNative: percentage(totalGainNative, totalCapitalNative),
    totalReturnPctCad: percentage(totalGainCad, totalCapitalCad),
  };
}

export function summarizeLedger(state: LedgerState): LedgerTotals {
  const totals = Object.values(state.positions).reduce<LedgerTotals>(
    (result, position) => ({
      realizedGainCad: result.realizedGainCad + position.realizedGainCad,
      grossDividendsCad:
        result.grossDividendsCad + position.grossDividendsCad,
      netDividendsCad: result.netDividendsCad + position.netDividendsCad,
      estimatedWithholdingCad:
        result.estimatedWithholdingCad +
        position.estimatedWithholdingCad,
      tradeFeesCad: result.tradeFeesCad + position.tradeFeesCad,
      fxFeesCad: result.fxFeesCad + position.fxFeesCad,
    }),
    {
      realizedGainCad: 0,
      grossDividendsCad: 0,
      netDividendsCad: 0,
      estimatedWithholdingCad: 0,
      tradeFeesCad: 0,
      fxFeesCad: 0,
    },
  );

  return {
    realizedGainCad: roundMoney(totals.realizedGainCad),
    grossDividendsCad: roundMoney(totals.grossDividendsCad),
    netDividendsCad: roundMoney(totals.netDividendsCad),
    estimatedWithholdingCad: roundMoney(
      totals.estimatedWithholdingCad,
    ),
    tradeFeesCad: roundMoney(totals.tradeFeesCad),
    fxFeesCad: roundMoney(totals.fxFeesCad),
  };
}
