import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./resolve-typescript.mjs", import.meta.url));

const { normalizeWealthsimpleCsv, sha256 } = await import(
  "../../lib/import/index.ts"
);

test("normalizes holdings aliases, quoted values, and reconciliation totals", () => {
  const csv = [
    "\uFEFFGenerated for Wealthsimple Trade",
    '"Security Symbol","Listing Exchange","Position Quantity","Book Cost Per Share (CAD)","Current Market Price","Currency","As of Date","Ignored Memo"',
    '"SHOP.TO","Toronto Stock Exchange","10","$100.25","$115.00","CAD","2026-07-23","do not retain this raw memo"',
    '"AAPL","NASDAQ","2.5","150.00","205.00","USD","2026-07-23","contains, comma"',
  ].join("\r\n");

  const result = normalizeWealthsimpleCsv(csv, {
    kind: "holdings",
    scope: "tfsa-primary",
    accountCurrency: "CAD",
  });

  assert.equal(result.kind, "holdings");
  assert.equal(result.records.length, 2);
  assert.equal(result.rows.every((row) => row.status === "accepted"), true);
  assert.equal(result.meta.headerRow, 2);
  assert.equal(result.meta.rawCsvRetained, false);
  assert.deepEqual(result.records[0], {
    source: "wealthsimple",
    kind: "holding",
    symbol: "SHOP",
    exchange: "TSX",
    quantity: 10,
    currency: "CAD",
    averageCost: 100.25,
    price: 115,
    asOfDate: "2026-07-23",
    importId: result.records[0].importId,
    rowHash: result.records[0].rowHash,
    rowNumber: 3,
  });
  assert.match(result.records[0].importId, /^wsh_[a-f0-9]{24}$/);
  assert.match(result.records[0].rowHash, /^[a-f0-9]{64}$/);
  assert.equal(
    result.warnings.some((warning) => warning.code === "SKIPPED_PREAMBLE_ROWS"),
    true,
  );
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === "ACCOUNT_CURRENCY_MISMATCH",
    ),
    true,
  );
  assert.deepEqual(result.reconciliation.holdings.bookValueByCurrency, {
    CAD: 1002.5,
    USD: 375,
  });
  assert.deepEqual(result.reconciliation.holdings.marketValueByCurrency, {
    CAD: 1150,
    USD: 512.5,
  });
  assert.doesNotMatch(JSON.stringify(result), /do not retain|contains, comma/);
});

test("produces stable hashes across official column variants and header order", () => {
  const first = normalizeWealthsimpleCsv(
    [
      "Symbol,Exchange,Quantity,Average Cost,Currency,Report Date",
      "RY,TSX,12,130.50,CAD,2026-07-23",
    ].join("\n"),
    { scope: "same-account" },
  );
  const second = normalizeWealthsimpleCsv(
    [
      "As of Date,Trading Currency,Book Value Per Share,Number of Shares,Market,Stock Symbol",
      "2026-07-23,C$,130.5000,12,TSE,ry",
    ].join("\n"),
    { scope: "same-account" },
  );

  assert.equal(first.records.length, 1);
  assert.equal(second.records.length, 1);
  assert.equal(first.records[0].rowHash, second.records[0].rowHash);
  assert.equal(first.records[0].importId, second.records[0].importId);
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("marks same-file and previously imported rows as duplicates", () => {
  const csv = [
    "Activity Type,Transaction ID,Trade Date,Symbol,Exchange,Shares,Execution Price,Transaction Currency,Commission",
    "Buy,txn-100,2026-07-20,AAPL,NASDAQ,1,200,USD,0",
    "Buy,txn-100,2026-07-20,AAPL,NASDAQ,1,200,USD,0",
  ].join("\n");
  const first = normalizeWealthsimpleCsv(csv, {
    kind: "activities",
    scope: "tfsa",
  });

  assert.equal(first.records.length, 1);
  assert.deepEqual(
    first.rows.map((row) => row.status),
    ["accepted", "duplicate"],
  );
  assert.deepEqual(first.rows[1].duplicateOf, {
    source: "batch",
    rowNumber: 2,
  });
  assert.equal(first.reconciliation.counts.duplicateRows, 1);

  const identity = {
    importId: first.records[0].importId,
    rowHash: first.records[0].rowHash,
  };
  const repeated = normalizeWealthsimpleCsv(csv.split("\n").slice(0, 2).join("\n"), {
    kind: "activities",
    scope: "tfsa",
    existingImports: [identity],
  });
  assert.equal(repeated.records.length, 0);
  assert.equal(repeated.rows[0].status, "duplicate");
  assert.equal(repeated.rows[0].duplicateOf.source, "existing");
});

test("rejects malformed rows with field-level errors but keeps valid rows", () => {
  const csv = [
    "Type,Date,Ticker,Market,Quantity,Price,Currency,Fee",
    "Buy,not-a-date,AAPL,NASDAQ,one,200,USD,0",
    "Sell,2026-07-21,,NYSE,-2,50,EUR,0",
    "Sell,2026-07-22,IBM,NYSE,-2,250,USD,(1.25)",
  ].join("\n");
  const result = normalizeWealthsimpleCsv(csv, { kind: "activities" });

  assert.equal(result.records.length, 1);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["rejected", "rejected", "accepted"],
  );
  assert.equal(result.records[0].kind, "activity");
  assert.equal(result.records[0].quantity, 2);
  assert.equal(result.records[0].fee, 1.25);
  assert.equal(
    result.errors.some((error) => error.code === "INVALID_DATE"),
    true,
  );
  assert.equal(
    result.errors.some((error) => error.code === "INVALID_NUMBER"),
    true,
  );
  assert.equal(
    result.errors.some((error) => error.code === "UNSUPPORTED_CURRENCY"),
    true,
  );
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === "NORMALIZED_SIGNED_QUANTITY",
    ),
    true,
  );
  assert.equal(
    result.warnings.some(
      (warning) => warning.code === "NORMALIZED_SIGNED_FEE",
    ),
    true,
  );
});

test("requires FX rate for explicit CAD-USD settlement mismatches", () => {
  const csv = [
    "Transaction Type,Transaction Date,Security Symbol,Listing Exchange,Quantity,Fill Price,Transaction Currency,Settlement Currency,FX Rate,Fees",
    "Buy,2026-07-20,AAPL,NASDAQ,1,200,USD,CAD,,0",
    "Buy,2026-07-21,MSFT,NASDAQ,2,500,USD,CAD,1.365,1.50",
  ].join("\n");
  const result = normalizeWealthsimpleCsv(csv, {
    kind: "activities",
    accountCurrency: "CAD",
  });

  assert.equal(result.rows[0].status, "rejected");
  assert.equal(
    result.rows[0].issues.some((entry) => entry.code === "FX_RATE_REQUIRED"),
    true,
  );
  assert.equal(result.rows[1].status, "accepted");
  assert.equal(result.records[0].fxRate, 1.365);
  assert.equal(result.reconciliation.activities.fxRows, 1);
  assert.equal(
    result.reconciliation.activities.accountCurrencyMismatchRows,
    2,
  );
});

test("accepts a partial holdings format using safe explicit inferences", () => {
  const csv = [
    "Ticker,Units,Market Price (USD)",
    "VTI,1.25,300",
  ].join("\n");
  const result = normalizeWealthsimpleCsv(csv, {
    kind: "holdings",
    defaultExchange: "NYSE Arca",
    defaultDate: "07/23/2026",
    dateOrder: "MDY",
  });

  assert.equal(result.records.length, 1);
  assert.deepEqual(
    {
      symbol: result.records[0].symbol,
      exchange: result.records[0].exchange,
      quantity: result.records[0].quantity,
      currency: result.records[0].currency,
      price: result.records[0].price,
      asOfDate: result.records[0].asOfDate,
    },
    {
      symbol: "VTI",
      exchange: "NYSE_ARCA",
      quantity: 1.25,
      currency: "USD",
      price: 300,
      asOfDate: "2026-07-23",
    },
  );
  assert.equal(
    result.warnings.some((entry) => entry.code === "INFERRED_CURRENCY"),
    true,
  );
  assert.equal(
    result.warnings.some((entry) => entry.code === "DEFAULTED_DATE"),
    true,
  );
  assert.equal(result.reconciliation.holdings.missingAverageCostRows, 1);
});

test("rejects security rows with no explicit exchange or ticker suffix", () => {
  const result = normalizeWealthsimpleCsv(
    [
      "Ticker,Units,Average Cost,Currency,As of Date",
      "AAPL,2,200,USD,2026-07-23",
    ].join("\n"),
    { kind: "holdings" },
  );

  assert.equal(result.records.length, 0);
  assert.equal(result.rows[0].status, "rejected");
  assert.equal(
    result.rows[0].issues.some(
      (entry) =>
        entry.severity === "error" && entry.field === "exchange",
    ),
    true,
  );
});

test("accepts partial cash activity exports without security columns", () => {
  const csv = [
    "Transaction Type,Effective Date,Net Amount (CAD)",
    "Contribution,2026-07-20,1000",
    "Withdrawal,2026-07-22,-125",
  ].join("\n");
  const result = normalizeWealthsimpleCsv(csv, {
    kind: "activities",
    scope: "tfsa-cash",
  });

  assert.deepEqual(
    result.records.map((record) => ({
      activityType: record.activityType,
      currency: record.currency,
      amount: record.amount,
    })),
    [
      { activityType: "DEPOSIT", currency: "CAD", amount: 1000 },
      { activityType: "WITHDRAWAL", currency: "CAD", amount: -125 },
    ],
  );
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.reconciliation.activities.reportedAmountByCurrency,
    { CAD: 875, USD: 0 },
  );
});

test("reports conflicting external identities instead of overwriting", () => {
  const baseCsv = [
    "Type,Activity ID,Date,Symbol,Exchange,Quantity,Price,Currency,Fee",
    "Buy,shared-id,2026-07-20,AAPL,NASDAQ,1,200,USD,0",
  ].join("\n");
  const original = normalizeWealthsimpleCsv(baseCsv, {
    kind: "activities",
    scope: "tfsa",
  });
  const changed = normalizeWealthsimpleCsv(
    baseCsv.replace(",1,200,", ",2,200,"),
    {
      kind: "activities",
      scope: "tfsa",
      existingImports: [
        {
          importId: original.records[0].importId,
          rowHash: original.records[0].rowHash,
        },
      ],
    },
  );

  assert.equal(changed.records.length, 0);
  assert.equal(changed.rows[0].status, "conflict");
  assert.equal(
    changed.rows[0].issues.some(
      (entry) => entry.code === "IMPORT_ID_CONFLICT",
    ),
    true,
  );
  assert.equal(changed.reconciliation.counts.conflictRows, 1);
});

test("fails closed on broken quoting and unrecognized files", () => {
  const broken = normalizeWealthsimpleCsv('Symbol,Quantity\n"AAPL,2');
  assert.equal(broken.records.length, 0);
  assert.equal(broken.errors[0].code, "CSV_UNCLOSED_QUOTE");

  const unrelated = normalizeWealthsimpleCsv("name,email\nAda,ada@example.com");
  assert.equal(unrelated.records.length, 0);
  assert.equal(unrelated.errors[0].code, "UNRECOGNIZED_FORMAT");
});
