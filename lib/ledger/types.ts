export type Currency = "CAD" | "USD";

export type DividendSourceCountry = "CA" | "US" | "OTHER";

export interface Security {
  symbol: string;
  exchange: string;
  currency: Currency;
}

export interface LedgerConfig {
  /**
   * When false, USD trades settle in CAD and incur the configured FX fee.
   * When true, USD trades and dividends settle in the USD cash balance.
   */
  usdAccountEnabled?: boolean;
  wealthsimpleFxFeeRate?: number;
  usDividendWithholdingRate?: number;
}

export interface ResolvedLedgerConfig {
  usdAccountEnabled: boolean;
  wealthsimpleFxFeeRate: number;
  usDividendWithholdingRate: number;
}

interface BaseTransaction {
  id: string;
  /**
   * An ISO date or timestamp. The leading four-digit calendar year is used for
   * contribution/withdrawal reporting; callers should provide the account's
   * local transaction date.
   */
  occurredAt: string;
}

export interface ContributionTransaction extends BaseTransaction {
  type: "contribution";
  amountCad: number;
}

export interface WithdrawalTransaction extends BaseTransaction {
  type: "withdrawal";
  amountCad: number;
}

/**
 * Establishes a reconciled opening position without pretending that the
 * snapshot itself was a trade. Both bases are supplied explicitly because a
 * holdings statement can report a CAD basis that differs from a spot FX
 * conversion of its native basis.
 */
export interface OpeningPositionTransaction extends BaseTransaction {
  type: "opening_position";
  security: Security;
  quantity: number;
  costBasisNative: number;
  costBasisCad: number;
}

interface BaseTradeTransaction extends BaseTransaction {
  security: Security;
  quantity: number;
  priceNative: number;
  feeNative?: number;
  /**
   * Pre-fee CAD value of one unit of the security's native currency. For a
   * Wealthsimple conversion, pass the corporate exchange rate before applying
   * the percentage FX fee. Required for USD securities and treated as 1 for
   * CAD securities.
   */
  cadPerNative?: number;
}

export interface BuyTransaction extends BaseTradeTransaction {
  type: "buy";
}

export interface SellTransaction extends BaseTradeTransaction {
  type: "sell";
}

export interface DividendTransaction extends BaseTransaction {
  type: "dividend";
  security: Security;
  grossAmountNative: number;
  sourceCountry: DividendSourceCountry;
  cadPerNative?: number;
  /**
   * Overrides the default estimate. Supplying this is useful when an account
   * statement provides the actual withholding rate.
   */
  withholdingRate?: number;
}

export type TradeTransaction = BuyTransaction | SellTransaction;

export type LedgerTransaction =
  | ContributionTransaction
  | WithdrawalTransaction
  | OpeningPositionTransaction
  | BuyTransaction
  | SellTransaction
  | DividendTransaction;

export interface Position {
  security: Security;
  quantity: number;
  costBasisNative: number;
  costBasisCad: number;
  averageCostNative: number;
  averageCostCad: number;
  realizedCostBasisNative: number;
  realizedCostBasisCad: number;
  realizedGainNative: number;
  realizedGainCad: number;
  grossDividendsNative: number;
  grossDividendsCad: number;
  netDividendsNative: number;
  netDividendsCad: number;
  estimatedWithholdingNative: number;
  estimatedWithholdingCad: number;
  tradeFeesNative: number;
  tradeFeesCad: number;
  fxFeesCad: number;
}

export interface TfsaFlows {
  contributionsCad: number;
  withdrawalsCad: number;
  /**
   * Contributions minus withdrawals. This is a cash-flow total, not a
   * calculation of available TFSA contribution room.
   */
  netCashFlowCad: number;
  contributionsByYearCad: Readonly<Record<string, number>>;
  withdrawalsByYearCad: Readonly<Record<string, number>>;
}

export interface CashBalances {
  CAD: number;
  USD: number;
}

export interface LedgerState {
  config: ResolvedLedgerConfig;
  cash: CashBalances;
  positions: Readonly<Record<string, Position>>;
  tfsa: TfsaFlows;
  processedTransactionIds: readonly string[];
}

export interface TradeCashFlow {
  side: "buy" | "sell";
  grossNative: number;
  feeNative: number;
  nativeCashAmount: number;
  cadPerNative: number;
  fxFeeRate: number;
  fxFeeCad: number;
  cashCurrency: Currency;
  cashDelta: number;
  cadEquivalentDelta: number;
}

export interface DividendReceipt {
  grossNative: number;
  grossCad: number;
  withholdingRate: number;
  withholdingEstimated: boolean;
  withholdingNative: number;
  withholdingCad: number;
  netNative: number;
  netCad: number;
  cashCurrency: Currency;
  cashDelta: number;
}

export interface MarketQuote {
  security: Security;
  priceNative: number;
  /**
   * Current pre-fee CAD value of one native-currency unit.
   */
  cadPerNative?: number;
}

export interface PositionValuation {
  security: Security;
  quantity: number;
  marketValueNative: number;
  marketValueCadAtSpot: number;
  estimatedSaleFxFeeCad: number;
  estimatedLiquidationValueCad: number;
  unrealizedGainNative: number;
  unrealizedGainCad: number;
  unrealizedReturnPctNative: number | null;
  unrealizedReturnPctCad: number | null;
  realizedGainNative: number;
  realizedGainCad: number;
  realizedReturnPctNative: number | null;
  realizedReturnPctCad: number | null;
  totalGainNative: number;
  totalGainCad: number;
  totalReturnPctNative: number | null;
  totalReturnPctCad: number | null;
}

export interface LedgerTotals {
  realizedGainCad: number;
  grossDividendsCad: number;
  netDividendsCad: number;
  estimatedWithholdingCad: number;
  tradeFeesCad: number;
  fxFeesCad: number;
}
