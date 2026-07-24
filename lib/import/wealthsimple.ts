import { isBlankCsvRow, parseCsv, type CsvRow } from "./csv";
import { sha256, stableHash } from "./hash";
import type {
  ActivitiesReconciliation,
  ActivityType,
  Currency,
  CurrencyTotals,
  DateOrder,
  HoldingsReconciliation,
  ImportCounts,
  ImportIssue,
  ImportRowResult,
  NormalizedActivity,
  NormalizedHolding,
  NormalizedWealthsimpleRecord,
  ReconciliationSummary,
  WealthsimpleImportKind,
  WealthsimpleImportOptions,
  WealthsimpleImportResult,
} from "./types";

type CanonicalField =
  | "type"
  | "symbol"
  | "exchange"
  | "quantity"
  | "averageCost"
  | "price"
  | "currency"
  | "settlementCurrency"
  | "date"
  | "fee"
  | "fxRate"
  | "amount"
  | "externalId";

interface ColumnReference {
  index: number;
  header: string;
}

type ColumnMap = Record<CanonicalField, ColumnReference[]>;

const FIELD_ALIASES = {
  type: [
    "activity type",
    "transaction type",
    "transaction action",
    "activity",
    "action",
    "type",
  ],
  symbol: [
    "security symbol",
    "stock symbol",
    "ticker symbol",
    "security ticker",
    "ticker",
    "symbol",
  ],
  exchange: [
    "listing exchange",
    "security exchange",
    "stock exchange",
    "exchange",
    "market",
  ],
  quantity: [
    "position quantity",
    "total quantity",
    "filled quantity",
    "share quantity",
    "number of shares",
    "number of units",
    "units",
    "shares",
    "quantity",
  ],
  averageCost: [
    "book cost per share",
    "book value per share",
    "adjusted cost basis per share",
    "cost basis per unit",
    "average unit cost",
    "average share price",
    "average price",
    "average cost",
    "avg cost",
    "unit book value",
  ],
  price: [
    "execution price",
    "fill price",
    "price per share",
    "transaction price",
    "current market price",
    "market price",
    "current price",
    "last price",
    "unit price",
    "price",
  ],
  currency: [
    "transaction currency",
    "security currency",
    "trading currency",
    "price currency",
    "asset currency",
    "currency",
  ],
  settlementCurrency: [
    "settlement currency",
    "account currency",
    "cash currency",
    "proceeds currency",
  ],
  date: [
    "transaction date",
    "activity date",
    "effective date",
    "report date",
    "as of date",
    "trade date",
    "filled at",
    "timestamp",
    "date",
  ],
  fee: [
    "total fees",
    "transaction fee",
    "commission fee",
    "commission/fee",
    "commissions",
    "commission",
    "fees",
    "fee",
  ],
  fxRate: [
    "foreign exchange rate",
    "currency conversion rate",
    "conversion rate",
    "exchange rate",
    "fx rate",
  ],
  amount: [
    "net transaction amount",
    "net cash amount",
    "net amount",
    "transaction amount",
    "cash amount",
    "total amount",
    "market value",
    "book value",
    "proceeds",
    "amount",
    "value",
  ],
  externalId: [
    "transaction id",
    "activity id",
    "order id",
    "reference id",
    "external id",
    "id",
  ],
} as const satisfies Record<CanonicalField, readonly string[]>;

const ALL_FIELDS = Object.keys(FIELD_ALIASES) as CanonicalField[];

const EXCHANGE_ALIASES: Record<string, string> = {
  tsx: "TSX",
  tse: "TSX",
  xtse: "TSX",
  "toronto stock exchange": "TSX",
  tsxv: "TSXV",
  cve: "TSXV",
  xtsx: "TSXV",
  "tsx venture": "TSXV",
  "tsx venture exchange": "TSXV",
  nasdaq: "NASDAQ",
  xnas: "NASDAQ",
  "nasdaq global select": "NASDAQ",
  "nasdaq global market": "NASDAQ",
  nyse: "NYSE",
  xnys: "NYSE",
  "new york stock exchange": "NYSE",
  "nyse arca": "NYSE_ARCA",
  arca: "NYSE_ARCA",
  arcx: "NYSE_ARCA",
  neo: "NEO",
  neoe: "NEO",
  "a equitas neo": "NEO",
  "aequitas neo": "NEO",
  "cboe canada": "NEO",
  cse: "CSE",
  cnsx: "CSE",
  xcnq: "CSE",
  "canadian securities exchange": "CSE",
  bats: "BATS",
  "cboe bzx": "BATS",
  "bats exchange": "BATS",
  otc: "OTC",
  otcmkts: "OTC",
};

const SYMBOL_SUFFIX_EXCHANGES: ReadonlyArray<[RegExp, string]> = [
  [/\.TO$/i, "TSX"],
  [/\.V$/i, "TSXV"],
  [/\.NE$/i, "NEO"],
  [/\.CN$/i, "CSE"],
];

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[_/()-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function headerMatchesAlias(header: string, alias: string): boolean {
  if (header === alias) {
    return true;
  }
  return (
    header === `${alias} cad` ||
    header === `${alias} usd` ||
    header === `${alias} c$` ||
    header === `${alias} us$`
  );
}

function buildColumnMap(headers: string[]): ColumnMap {
  const normalizedHeaders = headers.map(normalizeHeader);
  const result = Object.fromEntries(
    ALL_FIELDS.map((field) => [field, [] as ColumnReference[]]),
  ) as unknown as ColumnMap;

  for (const field of ALL_FIELDS) {
    const aliases = FIELD_ALIASES[field].map(normalizeHeader);
    for (const alias of aliases) {
      normalizedHeaders.forEach((header, index) => {
        if (
          headerMatchesAlias(header, alias) &&
          !result[field].some((column) => column.index === index)
        ) {
          result[field].push({ index, header });
        }
      });
    }
  }
  return result;
}

function recognizedFields(columns: ColumnMap): CanonicalField[] {
  return ALL_FIELDS.filter((field) => columns[field].length > 0);
}

function formatScores(columns: ColumnMap): {
  holdings: number;
  activities: number;
} {
  const has = (field: CanonicalField) => columns[field].length > 0;
  return {
    holdings:
      (has("symbol") ? 3 : 0) +
      (has("quantity") ? 2 : 0) +
      (has("averageCost") ? 3 : 0) +
      (has("price") ? 2 : 0) +
      (has("exchange") ? 1 : 0) +
      (has("currency") ? 1 : 0) +
      (has("date") ? 1 : 0),
    activities:
      (has("type") ? 5 : 0) +
      (has("date") ? 2 : 0) +
      (has("symbol") ? 1 : 0) +
      (has("quantity") ? 1 : 0) +
      (has("price") ? 1 : 0) +
      (has("currency") ? 1 : 0) +
      (has("amount") ? 1 : 0) +
      (has("fee") ? 1 : 0) +
      (has("fxRate") ? 1 : 0),
  };
}

function issue(
  severity: "error" | "warning",
  code: string,
  message: string,
  rowNumber: number,
  field?: string,
): ImportIssue {
  return { severity, code, message, rowNumber, field };
}

function readField(
  row: CsvRow,
  columns: ColumnReference[],
  field: CanonicalField,
  issues: ImportIssue[],
): { value?: string; header?: string } {
  const populated = columns
    .map((column) => ({
      value: row.cells[column.index]?.trim() ?? "",
      header: column.header,
    }))
    .filter((entry) => entry.value.length > 0);

  if (populated.length === 0) {
    return {};
  }
  const distinct = new Set(populated.map((entry) => entry.value));
  if (distinct.size > 1) {
    issues.push(
      issue(
        "warning",
        "CONFLICTING_ALIAS_VALUES",
        `Multiple columns mapped to ${field}; the highest-priority populated column was used.`,
        row.startLine,
        field,
      ),
    );
  }
  return populated[0];
}

function parseNumberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  let normalized = value
    .trim()
    .replace(/\u2212/g, "-")
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(/^(CAD|USD)/i, "")
    .replace(/(CAD|USD)$/i, "")
    .replace(/[$£€]/g, "")
    .replace(/'/g, "");

  let negative = false;
  if (/^\(.*\)$/.test(normalized)) {
    negative = true;
    normalized = normalized.slice(1, -1);
  }
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = /,\d{3}(?:,|$)/.test(normalized)
      ? normalized.replace(/,/g, "")
      : normalized.replace(",", ".");
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return negative ? -Math.abs(parsed) : parsed;
}

function requiredNumber(
  raw: string | undefined,
  rowNumber: number,
  field: string,
  issues: ImportIssue[],
): number | undefined {
  const value = parseNumberValue(raw);
  if (raw === undefined || raw.trim() === "") {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        `A ${field} value is required for this row.`,
        rowNumber,
        field,
      ),
    );
  } else if (value === undefined) {
    issues.push(
      issue(
        "error",
        "INVALID_NUMBER",
        `The ${field} value is not a valid finite number.`,
        rowNumber,
        field,
      ),
    );
  }
  return value;
}

function optionalNumber(
  raw: string | undefined,
  rowNumber: number,
  field: string,
  issues: ImportIssue[],
): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = parseNumberValue(raw);
  if (value === undefined) {
    issues.push(
      issue(
        "error",
        "INVALID_NUMBER",
        `The ${field} value is not a valid finite number.`,
        rowNumber,
        field,
      ),
    );
  }
  return value;
}

function canonicalCurrency(value: string | undefined): Currency | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[.\s]/g, "");
  if (
    ["CAD", "CDN", "C$", "CAD$", "CANADIANDOLLAR", "CANADIANDOLLARS"].includes(
      normalized,
    )
  ) {
    return "CAD";
  }
  if (
    ["USD", "US$", "USD$", "USDOLLAR", "USDOLLARS"].includes(normalized)
  ) {
    return "USD";
  }
  return undefined;
}

function currencyFromHeader(header: string | undefined): Currency | undefined {
  if (!header) {
    return undefined;
  }
  const tokens = new Set(normalizeHeader(header).split(" "));
  if (tokens.has("cad")) {
    return "CAD";
  }
  if (tokens.has("usd")) {
    return "USD";
  }
  return undefined;
}

function parseCurrency(
  raw: string | undefined,
  inferredHeader: string | undefined,
  fallback: Currency | undefined,
  rowNumber: number,
  field: string,
  issues: ImportIssue[],
): Currency | undefined {
  const parsed = canonicalCurrency(raw);
  if (raw && !parsed) {
    issues.push(
      issue(
        "error",
        "UNSUPPORTED_CURRENCY",
        `${field} must be CAD or USD.`,
        rowNumber,
        field,
      ),
    );
    return undefined;
  }
  if (parsed) {
    return parsed;
  }
  const inferred = currencyFromHeader(inferredHeader) ?? fallback;
  if (inferred) {
    issues.push(
      issue(
        "warning",
        "INFERRED_CURRENCY",
        `${field} was inferred because the row did not provide it explicitly.`,
        rowNumber,
        field,
      ),
    );
    return inferred;
  }
  issues.push(
    issue(
      "error",
      "MISSING_REQUIRED_VALUE",
      `${field} is required and could not be inferred.`,
      rowNumber,
      field,
    ),
  );
  return undefined;
}

function canonicalExchange(
  raw: string | undefined,
  rowNumber: number,
  issues: ImportIssue[],
): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const normalized = normalizeHeader(raw);
  const known = EXCHANGE_ALIASES[normalized];
  if (known) {
    return known;
  }
  const canonical = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!canonical) {
    return undefined;
  }
  issues.push(
    issue(
      "warning",
      "UNRECOGNIZED_EXCHANGE",
      "The exchange was canonicalized but is not one of the known Wealthsimple aliases.",
      rowNumber,
      "exchange",
    ),
  );
  return canonical;
}

function canonicalSecurity(
  rawSymbol: string | undefined,
  rawExchange: string | undefined,
  defaultExchange: string | undefined,
  rowNumber: number,
  issues: ImportIssue[],
): { symbol?: string; exchange?: string } {
  if (!rawSymbol?.trim()) {
    return {
      exchange: canonicalExchange(
        rawExchange ?? defaultExchange,
        rowNumber,
        issues,
      ),
    };
  }

  let symbol = rawSymbol
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/\s+/g, "");
  let suffixExchange: string | undefined;
  for (const [pattern, exchange] of SYMBOL_SUFFIX_EXCHANGES) {
    if (pattern.test(symbol)) {
      suffixExchange = exchange;
      symbol = symbol.replace(pattern, "");
      break;
    }
  }

  const exchange = canonicalExchange(
    rawExchange ?? defaultExchange ?? suffixExchange,
    rowNumber,
    issues,
  );
  if (suffixExchange && exchange && exchange !== suffixExchange) {
    issues.push(
      issue(
        "warning",
        "SYMBOL_EXCHANGE_MISMATCH",
        "The symbol suffix and exchange column disagree; the exchange column was used.",
        rowNumber,
        "exchange",
      ),
    );
  } else if (suffixExchange && !rawExchange && !defaultExchange) {
    issues.push(
      issue(
        "warning",
        "INFERRED_EXCHANGE",
        "The exchange was inferred from the symbol suffix.",
        rowNumber,
        "exchange",
      ),
    );
  }

  if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(symbol)) {
    issues.push(
      issue(
        "error",
        "INVALID_SYMBOL",
        "The symbol contains unsupported characters.",
        rowNumber,
        "symbol",
      ),
    );
    return { exchange };
  }
  return { symbol, exchange };
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  return (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) ===
    `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`
  );
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseDateValue(
  value: string | undefined,
  dateOrder: DateOrder,
): { value?: string; ambiguous?: boolean } {
  if (!value?.trim()) {
    return {};
  }
  const raw = value.trim();

  const isoDate = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoDate) {
    const [, year, month, day] = isoDate.map(Number);
    return validDateParts(year, month, day)
      ? { value: formatDateParts(year, month, day) }
      : {};
  }

  const isoLocalDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (isoLocalDateTime) {
    const [, year, month, day, hour, minute, second = 0] =
      isoLocalDateTime.map(Number);
    if (
      validDateParts(year, month, day) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59
    ) {
      return {
        value: `${formatDateParts(year, month, day)}T${hour
          .toString()
          .padStart(2, "0")}:${minute
          .toString()
          .padStart(2, "0")}:${second.toString().padStart(2, "0")}`,
      };
    }
    return {};
  }

  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? {}
      : { value: parsed.toISOString() };
  }

  const namedMonth = raw.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (namedMonth) {
    const month = MONTHS[namedMonth[1].toLowerCase()];
    const day = Number(namedMonth[2]);
    const year = Number(namedMonth[3]);
    return month && validDateParts(year, month, day)
      ? { value: formatDateParts(year, month, day) }
      : {};
  }

  const numeric = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (!numeric) {
    return {};
  }
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const third = Number(numeric[3]);
  let year: number;
  let month: number;
  let day: number;
  let ambiguous = false;

  if (dateOrder === "YMD" || numeric[1].length === 4) {
    year = first;
    month = second;
    day = third;
  } else {
    year = third;
    const useDmy =
      first > 12 || (second <= 12 && dateOrder === "DMY");
    day = useDmy ? first : second;
    month = useDmy ? second : first;
    ambiguous = first <= 12 && second <= 12;
  }
  return validDateParts(year, month, day)
    ? { value: formatDateParts(year, month, day), ambiguous }
    : {};
}

function normalizedDate(
  raw: string | undefined,
  fallback: string | undefined,
  rowNumber: number,
  field: string,
  issues: ImportIssue[],
  dateOrder: DateOrder,
  required: boolean,
): string | undefined {
  const effective = raw?.trim() ? raw : fallback;
  if (!effective) {
    issues.push(
      issue(
        required ? "error" : "warning",
        required ? "MISSING_REQUIRED_VALUE" : "MISSING_AS_OF_DATE",
        required
          ? `${field} is required.`
          : "No as-of date was provided; snapshot identity will use its content hash.",
        rowNumber,
        field,
      ),
    );
    return undefined;
  }
  const parsed = parseDateValue(effective, dateOrder);
  if (!parsed.value) {
    issues.push(
      issue(
        "error",
        "INVALID_DATE",
        `${field} is not a supported or valid date.`,
        rowNumber,
        field,
      ),
    );
    return undefined;
  }
  if (parsed.ambiguous) {
    issues.push(
      issue(
        "warning",
        "AMBIGUOUS_DATE",
        `The numeric ${field} was interpreted using ${dateOrder} order.`,
        rowNumber,
        field,
      ),
    );
  }
  if (!raw?.trim() && fallback) {
    issues.push(
      issue(
        "warning",
        "DEFAULTED_DATE",
        `${field} was supplied by the import options.`,
        rowNumber,
        field,
      ),
    );
  }
  return parsed.value;
}

function canonicalActivityType(
  raw: string | undefined,
  rowNumber: number,
  issues: ImportIssue[],
): ActivityType | undefined {
  if (!raw?.trim()) {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        "An activity type is required.",
        rowNumber,
        "type",
      ),
    );
    return undefined;
  }
  const normalized = normalizeHeader(raw);
  const exact: Record<string, ActivityType> = {
    buy: "BUY",
    bought: "BUY",
    purchase: "BUY",
    purchased: "BUY",
    sell: "SELL",
    sold: "SELL",
    sale: "SELL",
    dividend: "DIVIDEND",
    "cash dividend": "DIVIDEND",
    distribution: "DIVIDEND",
    deposit: "DEPOSIT",
    contribution: "DEPOSIT",
    "cash deposit": "DEPOSIT",
    withdrawal: "WITHDRAWAL",
    withdraw: "WITHDRAWAL",
    fee: "FEE",
    fees: "FEE",
    commission: "FEE",
    interest: "INTEREST",
    "interest payment": "INTEREST",
    "transfer in": "TRANSFER_IN",
    "inbound transfer": "TRANSFER_IN",
    "transfer out": "TRANSFER_OUT",
    "outbound transfer": "TRANSFER_OUT",
    "fx conversion": "FX_CONVERSION",
    "currency conversion": "FX_CONVERSION",
    "foreign exchange": "FX_CONVERSION",
    "stock split": "STOCK_SPLIT",
    split: "STOCK_SPLIT",
  };
  const mapped = exact[normalized];
  if (mapped) {
    return mapped;
  }
  if (/(^|\s)(buy|bought|purchase|purchased)(\s|$)/.test(normalized)) {
    return "BUY";
  }
  if (/(^|\s)(sell|sold|sale)(\s|$)/.test(normalized)) {
    return "SELL";
  }
  if (/(^|\s)(dividend|distribution)(\s|$)/.test(normalized)) {
    return "DIVIDEND";
  }
  issues.push(
    issue(
      "warning",
      "UNKNOWN_ACTIVITY_TYPE",
      "The activity type was preserved as OTHER because it is not a known alias.",
      rowNumber,
      "type",
    ),
  );
  return "OTHER";
}

function normalizeSignedQuantity(
  quantity: number | undefined,
  rowNumber: number,
  issues: ImportIssue[],
): number | undefined {
  if (quantity === undefined) {
    return undefined;
  }
  if (quantity < 0) {
    issues.push(
      issue(
        "warning",
        "NORMALIZED_SIGNED_QUANTITY",
        "A signed quantity was converted to its absolute value; direction is represented by activity type.",
        rowNumber,
        "quantity",
      ),
    );
    return Math.abs(quantity);
  }
  return quantity;
}

function hasErrors(issues: ImportIssue[]): boolean {
  return issues.some((entry) => entry.severity === "error");
}

function holdingFromRow(
  row: CsvRow,
  columns: ColumnMap,
  options: WealthsimpleImportOptions,
): { record?: NormalizedHolding; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const symbolCell = readField(row, columns.symbol, "symbol", issues);
  const exchangeCell = readField(row, columns.exchange, "exchange", issues);
  const quantityCell = readField(row, columns.quantity, "quantity", issues);
  const averageCostCell = readField(
    row,
    columns.averageCost,
    "averageCost",
    issues,
  );
  const priceCell = readField(row, columns.price, "price", issues);
  const currencyCell = readField(row, columns.currency, "currency", issues);
  const dateCell = readField(row, columns.date, "date", issues);

  const security = canonicalSecurity(
    symbolCell.value,
    exchangeCell.value,
    options.defaultExchange,
    row.startLine,
    issues,
  );
  if (!security.symbol) {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        "A security symbol is required for a holding.",
        row.startLine,
        "symbol",
      ),
    );
  }
  if (!security.exchange) {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        "An exchange is required and could not be inferred.",
        row.startLine,
        "exchange",
      ),
    );
  }

  const quantity = requiredNumber(
    quantityCell.value,
    row.startLine,
    "quantity",
    issues,
  );
  if (quantity !== undefined && quantity < 0) {
    issues.push(
      issue(
        "error",
        "NEGATIVE_HOLDING_QUANTITY",
        "A holding quantity cannot be negative.",
        row.startLine,
        "quantity",
      ),
    );
  }
  const averageCost = optionalNumber(
    averageCostCell.value,
    row.startLine,
    "averageCost",
    issues,
  );
  const price = optionalNumber(
    priceCell.value,
    row.startLine,
    "price",
    issues,
  );
  if (averageCost === undefined && price === undefined) {
    issues.push(
      issue(
        "error",
        "MISSING_COST_OR_PRICE",
        "A holding needs either average cost or market price.",
        row.startLine,
        "averageCost",
      ),
    );
  }
  if (averageCost !== undefined && averageCost < 0) {
    issues.push(
      issue(
        "error",
        "NEGATIVE_PRICE",
        "Average cost cannot be negative.",
        row.startLine,
        "averageCost",
      ),
    );
  }
  if (price !== undefined && price < 0) {
    issues.push(
      issue(
        "error",
        "NEGATIVE_PRICE",
        "Market price cannot be negative.",
        row.startLine,
        "price",
      ),
    );
  }

  const currency = parseCurrency(
    currencyCell.value,
    [averageCostCell.header, priceCell.header].find(
      (header) => currencyFromHeader(header) !== undefined,
    ),
    options.defaultCurrency,
    row.startLine,
    "currency",
    issues,
  );
  const asOfDate = normalizedDate(
    dateCell.value,
    options.defaultDate,
    row.startLine,
    "asOfDate",
    issues,
    options.dateOrder ?? "MDY",
    false,
  );
  if (
    currency &&
    options.accountCurrency &&
    currency !== options.accountCurrency
  ) {
    issues.push(
      issue(
        "warning",
        "ACCOUNT_CURRENCY_MISMATCH",
        "The security currency differs from the configured account currency.",
        row.startLine,
        "currency",
      ),
    );
  }

  if (
    hasErrors(issues) ||
    !security.symbol ||
    !security.exchange ||
    quantity === undefined ||
    !currency
  ) {
    return { issues };
  }

  const payload = {
    source: "wealthsimple",
    kind: "holding",
    symbol: security.symbol,
    exchange: security.exchange,
    quantity,
    currency,
    averageCost,
    price,
    asOfDate,
  } as const;
  const rowHash = stableHash(payload);
  const identity = asOfDate
    ? {
        scope: options.scope ?? "",
        kind: "holding",
        symbol: security.symbol,
        exchange: security.exchange,
        currency,
        asOfDate,
      }
    : { scope: options.scope ?? "", kind: "holding", rowHash };
  const importId = `wsh_${stableHash(identity).slice(0, 24)}`;

  return {
    issues,
    record: {
      ...payload,
      importId,
      rowHash,
      rowNumber: row.startLine,
    },
  };
}

function activityFromRow(
  row: CsvRow,
  columns: ColumnMap,
  options: WealthsimpleImportOptions,
): { record?: NormalizedActivity; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const typeCell = readField(row, columns.type, "type", issues);
  const symbolCell = readField(row, columns.symbol, "symbol", issues);
  const exchangeCell = readField(row, columns.exchange, "exchange", issues);
  const quantityCell = readField(row, columns.quantity, "quantity", issues);
  const priceCell = readField(row, columns.price, "price", issues);
  const currencyCell = readField(row, columns.currency, "currency", issues);
  const settlementCell = readField(
    row,
    columns.settlementCurrency,
    "settlementCurrency",
    issues,
  );
  const dateCell = readField(row, columns.date, "date", issues);
  const feeCell = readField(row, columns.fee, "fee", issues);
  const fxCell = readField(row, columns.fxRate, "fxRate", issues);
  const amountCell = readField(row, columns.amount, "amount", issues);
  const externalIdCell = readField(
    row,
    columns.externalId,
    "externalId",
    issues,
  );

  const activityType = canonicalActivityType(
    typeCell.value,
    row.startLine,
    issues,
  );
  const date = normalizedDate(
    dateCell.value,
    options.defaultDate,
    row.startLine,
    "date",
    issues,
    options.dateOrder ?? "MDY",
    true,
  );
  const currency = parseCurrency(
    currencyCell.value,
    [priceCell.header, amountCell.header, feeCell.header].find(
      (header) => currencyFromHeader(header) !== undefined,
    ),
    options.defaultCurrency,
    row.startLine,
    "currency",
    issues,
  );
  const settlementCurrency = settlementCell.value
    ? parseCurrency(
        settlementCell.value,
        settlementCell.header,
        undefined,
        row.startLine,
        "settlementCurrency",
        issues,
      )
    : options.settlementCurrency;

  const security = canonicalSecurity(
    symbolCell.value,
    exchangeCell.value,
    options.defaultExchange,
    row.startLine,
    issues,
  );
  const needsSecurity =
    activityType === "BUY" ||
    activityType === "SELL" ||
    activityType === "STOCK_SPLIT";
  if (needsSecurity && !security.symbol) {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        "A symbol is required for this security activity.",
        row.startLine,
        "symbol",
      ),
    );
  }
  if (needsSecurity && !security.exchange) {
    issues.push(
      issue(
        "error",
        "MISSING_REQUIRED_VALUE",
        "An exchange is required for this security activity.",
        row.startLine,
        "exchange",
      ),
    );
  }

  const parsedQuantity = needsSecurity
    ? requiredNumber(
        quantityCell.value,
        row.startLine,
        "quantity",
        issues,
      )
    : optionalNumber(
        quantityCell.value,
        row.startLine,
        "quantity",
        issues,
      );
  const quantity = normalizeSignedQuantity(
    parsedQuantity,
    row.startLine,
    issues,
  );
  if (needsSecurity && quantity !== undefined && quantity <= 0) {
    issues.push(
      issue(
        "error",
        "NON_POSITIVE_QUANTITY",
        "Security activity quantity must be greater than zero.",
        row.startLine,
        "quantity",
      ),
    );
  }

  const needsPrice = activityType === "BUY" || activityType === "SELL";
  const price = needsPrice
    ? requiredNumber(priceCell.value, row.startLine, "price", issues)
    : optionalNumber(priceCell.value, row.startLine, "price", issues);
  if (price !== undefined && price < 0) {
    issues.push(
      issue(
        "error",
        "NEGATIVE_PRICE",
        "Price cannot be negative.",
        row.startLine,
        "price",
      ),
    );
  }

  let fee = optionalNumber(
    feeCell.value,
    row.startLine,
    "fee",
    issues,
  );
  if (fee === undefined) {
    fee = 0;
    if (needsPrice) {
      issues.push(
        issue(
          "warning",
          "ASSUMED_ZERO_FEE",
          "No fee was supplied for the trade; zero was assumed.",
          row.startLine,
          "fee",
        ),
      );
    }
  } else if (fee < 0) {
    fee = Math.abs(fee);
    issues.push(
      issue(
        "warning",
        "NORMALIZED_SIGNED_FEE",
        "A signed fee was converted to its absolute cost.",
        row.startLine,
        "fee",
      ),
    );
  }

  const amount = optionalNumber(
    amountCell.value,
    row.startLine,
    "amount",
    issues,
  );
  const fxRate = optionalNumber(
    fxCell.value,
    row.startLine,
    "fxRate",
    issues,
  );
  if (fxRate !== undefined && fxRate <= 0) {
    issues.push(
      issue(
        "error",
        "INVALID_FX_RATE",
        "FX rate must be greater than zero.",
        row.startLine,
        "fxRate",
      ),
    );
  }
  if (
    currency &&
    settlementCurrency &&
    currency !== settlementCurrency &&
    fxRate === undefined
  ) {
    issues.push(
      issue(
        "error",
        "FX_RATE_REQUIRED",
        "FX rate is required when transaction and settlement currencies differ.",
        row.startLine,
        "fxRate",
      ),
    );
  }
  if (activityType === "FX_CONVERSION" && fxRate === undefined) {
    issues.push(
      issue(
        "error",
        "FX_RATE_REQUIRED",
        "An FX conversion activity requires an FX rate.",
        row.startLine,
        "fxRate",
      ),
    );
  }
  if (
    currency &&
    settlementCurrency &&
    currency === settlementCurrency &&
    fxRate !== undefined &&
    fxRate !== 1
  ) {
    issues.push(
      issue(
        "warning",
        "UNEXPECTED_FX_RATE",
        "A non-unit FX rate was supplied even though both currencies are the same.",
        row.startLine,
        "fxRate",
      ),
    );
  }
  if (
    currency &&
    options.accountCurrency &&
    currency !== options.accountCurrency
  ) {
    issues.push(
      issue(
        "warning",
        "ACCOUNT_CURRENCY_MISMATCH",
        "The transaction currency differs from the configured account currency.",
        row.startLine,
        "currency",
      ),
    );
  }

  if (
    hasErrors(issues) ||
    !activityType ||
    !date ||
    !currency ||
    (needsSecurity && (!security.symbol || !security.exchange)) ||
    (needsSecurity && quantity === undefined) ||
    (needsPrice && price === undefined)
  ) {
    return { issues };
  }

  const payload = {
    source: "wealthsimple",
    kind: "activity",
    activityType,
    date,
    currency,
    settlementCurrency,
    symbol: security.symbol,
    exchange: security.exchange,
    quantity,
    price,
    amount,
    fee,
    fxRate,
  } as const;
  const rowHash = stableHash(payload);
  const externalIdentity = externalIdCell.value?.trim();
  const identity = externalIdentity
    ? {
        scope: options.scope ?? "",
        kind: "activity",
        externalIdHash: sha256(externalIdentity),
      }
    : { scope: options.scope ?? "", kind: "activity", rowHash };
  const importId = `wsa_${stableHash(identity).slice(0, 24)}`;

  return {
    issues,
    record: {
      ...payload,
      importId,
      rowHash,
      rowNumber: row.startLine,
    },
  };
}

function emptyCurrencyTotals(): CurrencyTotals {
  return { CAD: 0, USD: 0 };
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function roundTotals(totals: CurrencyTotals): CurrencyTotals {
  return { CAD: rounded(totals.CAD), USD: rounded(totals.USD) };
}

function buildCounts(rows: ImportRowResult[]): ImportCounts {
  const warnings = rows.flatMap((row) =>
    row.issues.filter((entry) => entry.severity === "warning"),
  );
  const errors = rows.flatMap((row) =>
    row.issues.filter((entry) => entry.severity === "error"),
  );
  return {
    inputRows: rows.length,
    acceptedRows: rows.filter((row) => row.status === "accepted").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    rejectedRows: rows.filter((row) => row.status === "rejected").length,
    conflictRows: rows.filter((row) => row.status === "conflict").length,
    warningRows: rows.filter((row) =>
      row.issues.some((entry) => entry.severity === "warning"),
    ).length,
    totalWarnings: warnings.length,
    totalErrors: errors.length,
  };
}

export function summarizeReconciliation(
  kind: WealthsimpleImportKind,
  records: readonly NormalizedWealthsimpleRecord[],
  rows: readonly ImportRowResult[] = [],
): ReconciliationSummary {
  const counts = buildCounts([...rows]);

  if (kind === "holdings") {
    const holdings = records.filter(
      (record): record is NormalizedHolding => record.kind === "holding",
    );
    const quantityByCurrency = emptyCurrencyTotals();
    const bookValueByCurrency = emptyCurrencyTotals();
    const marketValueByCurrency = emptyCurrencyTotals();
    let missingAverageCostRows = 0;
    let missingMarketPriceRows = 0;
    for (const holding of holdings) {
      quantityByCurrency[holding.currency] += holding.quantity;
      if (holding.averageCost === undefined) {
        missingAverageCostRows += 1;
      } else {
        bookValueByCurrency[holding.currency] +=
          holding.quantity * holding.averageCost;
      }
      if (holding.price === undefined) {
        missingMarketPriceRows += 1;
      } else {
        marketValueByCurrency[holding.currency] +=
          holding.quantity * holding.price;
      }
    }
    const summary: HoldingsReconciliation = {
      positions: holdings.length,
      quantityByCurrency: roundTotals(quantityByCurrency),
      bookValueByCurrency: roundTotals(bookValueByCurrency),
      marketValueByCurrency: roundTotals(marketValueByCurrency),
      missingAverageCostRows,
      missingMarketPriceRows,
    };
    return { kind, counts, holdings: summary };
  }

  const activities = records.filter(
    (record): record is NormalizedActivity => record.kind === "activity",
  );
  const tradeNotionalByCurrency = emptyCurrencyTotals();
  const feesByCurrency = emptyCurrencyTotals();
  const reportedAmountByCurrency = emptyCurrencyTotals();
  const estimatedTradeCashFlowByCurrency = emptyCurrencyTotals();
  let buys = 0;
  let sells = 0;
  let fxRows = 0;

  for (const activity of activities) {
    feesByCurrency[activity.currency] += activity.fee;
    if (activity.amount !== undefined) {
      reportedAmountByCurrency[activity.currency] += activity.amount;
    }
    if (activity.fxRate !== undefined) {
      fxRows += 1;
    }
    if (
      (activity.activityType === "BUY" ||
        activity.activityType === "SELL") &&
      activity.quantity !== undefined &&
      activity.price !== undefined
    ) {
      const notional = activity.quantity * activity.price;
      tradeNotionalByCurrency[activity.currency] += notional;
      if (activity.activityType === "BUY") {
        buys += 1;
        estimatedTradeCashFlowByCurrency[activity.currency] -=
          notional + activity.fee;
      } else {
        sells += 1;
        estimatedTradeCashFlowByCurrency[activity.currency] +=
          notional - activity.fee;
      }
    }
  }
  const dates = activities.map((activity) => activity.date).sort();
  const accountCurrencyMismatchRows = rows.filter((row) =>
    row.issues.some((entry) => entry.code === "ACCOUNT_CURRENCY_MISMATCH"),
  ).length;
  const summary: ActivitiesReconciliation = {
    activities: activities.length,
    buys,
    sells,
    ...(dates.length > 0
      ? { dateRange: { from: dates[0], to: dates[dates.length - 1] } }
      : {}),
    tradeNotionalByCurrency: roundTotals(tradeNotionalByCurrency),
    feesByCurrency: roundTotals(feesByCurrency),
    reportedAmountByCurrency: roundTotals(reportedAmountByCurrency),
    estimatedTradeCashFlowByCurrency: roundTotals(
      estimatedTradeCashFlowByCurrency,
    ),
    fxRows,
    accountCurrencyMismatchRows,
  };
  return { kind, counts, activities: summary };
}

function existingIdentityMap(
  existing: WealthsimpleImportOptions["existingImports"],
): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  if (!existing) {
    return result;
  }
  for (const entry of existing) {
    if (typeof entry === "string") {
      result.set(entry, undefined);
    } else {
      result.set(entry.importId, entry.rowHash);
    }
  }
  return result;
}

function applyDeduplication(
  parsedRows: Array<{
    rowNumber: number;
    record?: NormalizedWealthsimpleRecord;
    issues: ImportIssue[];
  }>,
  existing: Map<string, string | undefined>,
): ImportRowResult[] {
  const seen = new Map<
    string,
    { rowHash: string; rowNumber: number }
  >();
  const results: ImportRowResult[] = [];

  for (const parsed of parsedRows) {
    if (!parsed.record || hasErrors(parsed.issues)) {
      results.push({
        rowNumber: parsed.rowNumber,
        status: "rejected",
        issues: parsed.issues,
      });
      continue;
    }
    const { importId, rowHash } = parsed.record;
    const existingHash = existing.get(importId);
    if (existing.has(importId)) {
      if (existingHash === undefined || existingHash === rowHash) {
        const duplicateIssue = issue(
          "warning",
          "ALREADY_IMPORTED",
          "This row matches an import identity already known to the caller.",
          parsed.rowNumber,
        );
        results.push({
          rowNumber: parsed.rowNumber,
          status: "duplicate",
          importId,
          rowHash,
          duplicateOf: { source: "existing" },
          issues: [...parsed.issues, duplicateIssue],
        });
      } else {
        const conflictIssue = issue(
          "error",
          "IMPORT_ID_CONFLICT",
          "This import identity already exists with different normalized content.",
          parsed.rowNumber,
        );
        results.push({
          rowNumber: parsed.rowNumber,
          status: "conflict",
          importId,
          rowHash,
          duplicateOf: { source: "existing" },
          issues: [...parsed.issues, conflictIssue],
        });
      }
      continue;
    }

    const prior = seen.get(importId);
    if (prior) {
      if (prior.rowHash === rowHash) {
        const duplicateIssue = issue(
          "warning",
          "DUPLICATE_ROW",
          "This row duplicates an earlier normalized row in the same CSV.",
          parsed.rowNumber,
        );
        results.push({
          rowNumber: parsed.rowNumber,
          status: "duplicate",
          importId,
          rowHash,
          duplicateOf: { source: "batch", rowNumber: prior.rowNumber },
          issues: [...parsed.issues, duplicateIssue],
        });
      } else {
        const conflictIssue = issue(
          "error",
          "IMPORT_ID_CONFLICT",
          "Two rows share an import identity but contain different normalized values.",
          parsed.rowNumber,
        );
        results.push({
          rowNumber: parsed.rowNumber,
          status: "conflict",
          importId,
          rowHash,
          duplicateOf: { source: "batch", rowNumber: prior.rowNumber },
          issues: [...parsed.issues, conflictIssue],
        });
      }
      continue;
    }

    seen.set(importId, { rowHash, rowNumber: parsed.rowNumber });
    results.push({
      rowNumber: parsed.rowNumber,
      status: "accepted",
      importId,
      rowHash,
      record: parsed.record,
      issues: parsed.issues,
    });
  }
  return results;
}

function emptyResult(
  errors: ImportIssue[],
  warnings: ImportIssue[] = [],
): WealthsimpleImportResult {
  return {
    source: "wealthsimple",
    records: [],
    rows: [],
    errors,
    warnings,
    meta: { recognizedFields: [], rawCsvRetained: false },
  };
}

export function normalizeWealthsimpleCsv(
  csv: string,
  options: WealthsimpleImportOptions = {},
): WealthsimpleImportResult {
  const parsed = parseCsv(csv);
  if (parsed.issues.length > 0) {
    return emptyResult(
      parsed.issues.map((entry) =>
        issue("error", entry.code, entry.message, entry.line),
      ),
    );
  }

  const nonBlankRows = parsed.rows.filter((row) => !isBlankCsvRow(row));
  if (nonBlankRows.length === 0) {
    return emptyResult([
      issue("error", "EMPTY_CSV", "The CSV contains no rows.", 1),
    ]);
  }

  const candidates = nonBlankRows.slice(0, 10).map((row, candidateIndex) => {
    const columns = buildColumnMap(row.cells);
    const scores = formatScores(columns);
    const requestedKind = options.kind ?? "auto";
    const score =
      requestedKind === "holdings"
        ? scores.holdings
        : requestedKind === "activities"
          ? scores.activities
          : Math.max(scores.holdings, scores.activities);
    return { row, candidateIndex, columns, scores, score };
  });
  candidates.sort((left, right) => right.score - left.score);
  const header = candidates[0];

  if (!header || header.score < 5) {
    return emptyResult([
      issue(
        "error",
        "UNRECOGNIZED_FORMAT",
        "Could not identify a Wealthsimple holdings or activities header.",
        nonBlankRows[0].startLine,
      ),
    ]);
  }

  const requestedKind = options.kind ?? "auto";
  const kind: WealthsimpleImportKind =
    requestedKind === "holdings" || requestedKind === "activities"
      ? requestedKind
      : header.columns.type.length > 0 ||
          header.scores.activities > header.scores.holdings
        ? "activities"
        : "holdings";
  const globalErrors: ImportIssue[] = [];
  const globalWarnings: ImportIssue[] = [];
  const fields = recognizedFields(header.columns);

  const requiredHeaderFields: CanonicalField[] =
    kind === "holdings" ? ["symbol", "quantity"] : ["type"];
  for (const field of requiredHeaderFields) {
    if (header.columns[field].length === 0) {
      globalErrors.push(
        issue(
          "error",
          "MISSING_REQUIRED_COLUMN",
          `The detected ${kind} CSV is missing a ${field} column.`,
          header.row.startLine,
          field,
        ),
      );
    }
  }
  if (
    kind === "holdings" &&
    header.columns.averageCost.length === 0 &&
    header.columns.price.length === 0
  ) {
    globalErrors.push(
      issue(
        "error",
        "MISSING_REQUIRED_COLUMN",
        "A holdings CSV needs an average-cost or price column.",
        header.row.startLine,
        "averageCost",
      ),
    );
  }
  if (kind === "activities" && header.columns.date.length === 0 && !options.defaultDate) {
    globalErrors.push(
      issue(
        "error",
        "MISSING_REQUIRED_COLUMN",
        "An activities CSV needs a date column or defaultDate option.",
        header.row.startLine,
        "date",
      ),
    );
  }

  const normalizedHeaders = header.row.cells.map(normalizeHeader);
  const duplicateHeaders = new Set<string>();
  normalizedHeaders.forEach((value, index) => {
    if (
      value &&
      normalizedHeaders.indexOf(value) !== index
    ) {
      duplicateHeaders.add(value);
    }
  });
  if (duplicateHeaders.size > 0) {
    globalWarnings.push(
      issue(
        "warning",
        "DUPLICATE_HEADERS",
        "The CSV has duplicate headers; canonical alias priority will be used.",
        header.row.startLine,
      ),
    );
  }
  if (header.candidateIndex > 0) {
    globalWarnings.push(
      issue(
        "warning",
        "SKIPPED_PREAMBLE_ROWS",
        `${header.candidateIndex} non-empty preamble row(s) were skipped before the header.`,
        header.row.startLine,
      ),
    );
  }

  if (globalErrors.length > 0) {
    return {
      source: "wealthsimple",
      kind,
      records: [],
      rows: [],
      errors: globalErrors,
      warnings: globalWarnings,
      meta: {
        headerRow: header.row.startLine,
        recognizedFields: fields,
        rawCsvRetained: false,
      },
    };
  }

  const headerIndex = nonBlankRows.findIndex(
    (row) => row === header.row,
  );
  const dataRows = nonBlankRows.slice(headerIndex + 1);
  const normalizedRows = dataRows.map((row) => {
    const normalized =
      kind === "holdings"
        ? holdingFromRow(row, header.columns, options)
        : activityFromRow(row, header.columns, options);
    return { rowNumber: row.startLine, ...normalized };
  });
  const rows = applyDeduplication(
    normalizedRows,
    existingIdentityMap(options.existingImports),
  );
  const records = rows.flatMap((row) =>
    row.status === "accepted" && row.record ? [row.record] : [],
  );
  const rowIssues = rows.flatMap((row) => row.issues);
  const errors = [
    ...globalErrors,
    ...rowIssues.filter((entry) => entry.severity === "error"),
  ];
  const warnings = [
    ...globalWarnings,
    ...rowIssues.filter((entry) => entry.severity === "warning"),
  ];

  return {
    source: "wealthsimple",
    kind,
    records,
    rows,
    errors,
    warnings,
    reconciliation: summarizeReconciliation(kind, records, rows),
    meta: {
      headerRow: header.row.startLine,
      recognizedFields: fields,
      rawCsvRetained: false,
    },
  };
}
