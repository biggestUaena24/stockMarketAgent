export type WealthsimpleImportKind = "holdings" | "activities";
export type ImportKindOption = WealthsimpleImportKind | "auto";
export type Currency = "CAD" | "USD";
export type DateOrder = "MDY" | "DMY" | "YMD";

export type ActivityType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "INTEREST"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "FX_CONVERSION"
  | "STOCK_SPLIT"
  | "OTHER";

export type ImportIssueSeverity = "error" | "warning";

export interface ImportIssue {
  severity: ImportIssueSeverity;
  code: string;
  message: string;
  rowNumber: number;
  field?: string;
}

interface NormalizedRecordBase {
  source: "wealthsimple";
  importId: string;
  rowHash: string;
  rowNumber: number;
}

export interface NormalizedHolding extends NormalizedRecordBase {
  kind: "holding";
  symbol: string;
  exchange: string;
  quantity: number;
  currency: Currency;
  averageCost?: number;
  price?: number;
  asOfDate?: string;
}

export interface NormalizedActivity extends NormalizedRecordBase {
  kind: "activity";
  activityType: ActivityType;
  date: string;
  currency: Currency;
  settlementCurrency?: Currency;
  symbol?: string;
  exchange?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  fee: number;
  fxRate?: number;
}

export type NormalizedWealthsimpleRecord =
  | NormalizedHolding
  | NormalizedActivity;

export type ImportRowStatus =
  | "accepted"
  | "duplicate"
  | "conflict"
  | "rejected";

export interface DuplicateReference {
  source: "batch" | "existing";
  rowNumber?: number;
}

export interface ImportRowResult {
  rowNumber: number;
  status: ImportRowStatus;
  importId?: string;
  rowHash?: string;
  record?: NormalizedWealthsimpleRecord;
  duplicateOf?: DuplicateReference;
  issues: ImportIssue[];
}

export interface ExistingImportIdentity {
  importId: string;
  rowHash?: string;
}

export interface WealthsimpleImportOptions {
  kind?: ImportKindOption;
  /**
   * A stable, non-secret caller-defined account key. It is hashed into import
   * identifiers and is never returned.
   */
  scope?: string;
  accountCurrency?: Currency;
  settlementCurrency?: Currency;
  defaultCurrency?: Currency;
  defaultExchange?: string;
  defaultDate?: string;
  dateOrder?: DateOrder;
  existingImports?: Iterable<string | ExistingImportIdentity>;
}

export interface ImportCounts {
  inputRows: number;
  acceptedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  conflictRows: number;
  warningRows: number;
  totalWarnings: number;
  totalErrors: number;
}

export interface CurrencyTotals {
  CAD: number;
  USD: number;
}

export interface HoldingsReconciliation {
  positions: number;
  quantityByCurrency: CurrencyTotals;
  bookValueByCurrency: CurrencyTotals;
  marketValueByCurrency: CurrencyTotals;
  missingAverageCostRows: number;
  missingMarketPriceRows: number;
}

export interface ActivitiesReconciliation {
  activities: number;
  buys: number;
  sells: number;
  dateRange?: {
    from: string;
    to: string;
  };
  tradeNotionalByCurrency: CurrencyTotals;
  feesByCurrency: CurrencyTotals;
  reportedAmountByCurrency: CurrencyTotals;
  estimatedTradeCashFlowByCurrency: CurrencyTotals;
  fxRows: number;
  accountCurrencyMismatchRows: number;
}

export interface ReconciliationSummary {
  kind: WealthsimpleImportKind;
  counts: ImportCounts;
  holdings?: HoldingsReconciliation;
  activities?: ActivitiesReconciliation;
}

export interface WealthsimpleImportResult {
  source: "wealthsimple";
  kind?: WealthsimpleImportKind;
  records: NormalizedWealthsimpleRecord[];
  rows: ImportRowResult[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  reconciliation?: ReconciliationSummary;
  meta: {
    headerRow?: number;
    recognizedFields: string[];
    rawCsvRetained: false;
  };
}

export interface LedgerImportPreviewTransaction {
  action: string;
  canonicalSymbol: string;
  exchange: string;
  quantity: number;
  price: number;
  currency: Currency;
  fee: number;
  fxRateToCad: number;
  occurredAt: string;
}

export interface LedgerImportPreviewRow {
  rowNumber: number;
  importId: string;
  sourceKind: NormalizedWealthsimpleRecord["kind"];
  status: "ready" | "blocked";
  transaction: LedgerImportPreviewTransaction | null;
  issues: ImportIssue[];
}
