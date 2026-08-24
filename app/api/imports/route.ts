import { and, desc, eq, sql } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { importBatches, ownerSettings, transactions } from "@/db/schema";
import { requireApiOwner } from "@/lib/api-context";
import { ApiError, errorResponse } from "@/lib/http";
import {
  assessImportSafety,
  normalizeWealthsimpleCsv,
  sha256 as importSha256,
  type ImportIssue,
  type LedgerImportPreviewRow,
  type LedgerImportValues,
  type NormalizedWealthsimpleRecord,
} from "@/lib/import";
import { newId } from "@/lib/ids";
import { getOrCreateSettings } from "@/lib/settings";
import { validateTransactionInput } from "@/lib/transactions";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
// Seven rows keep each multi-value INSERT below D1's bound-parameter limit;
// 600 rows stay below the 100-statement batch ceiling after metadata/reset work.
const MAX_ATOMIC_IMPORT_ROWS = 600;
const IMPORT_INSERT_CHUNK_SIZE = 7;

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const db = await getReadyDb();
    const batches = await db
      .select()
      .from(importBatches)
      .where(eq(importBatches.ownerEmail, auth.ownerEmail))
      .orderBy(desc(importBatches.createdAt))
      .limit(20);
    return Response.json({
      batches: batches.map((batch) => ({
        ...batch,
        reconciliation: parseObject(batch.reconciliationJson),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("Choose a Wealthsimple CSV file.");
    }
    if (file.size <= 0 || file.size > MAX_CSV_BYTES) {
      throw new ApiError("CSV files must be between 1 byte and 2 MB.");
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new ApiError("Only .csv files are accepted.");
    }

    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const settings = await getOrCreateSettings(auth.ownerEmail);
    const db = await getReadyDb();
    const existingRows = await db
      .select({
        action: transactions.action,
        canonicalSymbol: transactions.canonicalSymbol,
        exchange: transactions.exchange,
        quantity: transactions.quantity,
        price: transactions.price,
        currency: transactions.currency,
        fee: transactions.fee,
        fxRateToCad: transactions.fxRateToCad,
        occurredAt: transactions.occurredAt,
        importId: transactions.importId,
        rowHash: transactions.importRowHash,
        notes: transactions.notes,
      })
      .from(transactions)
      .where(eq(transactions.ownerEmail, auth.ownerEmail));
    const csv = await file.text();
    const scope = importSha256(`cedar|${auth.ownerEmail.toLowerCase()}`);
    const requestedKind =
      form.get("kind") === "holdings" || form.get("kind") === "activities"
        ? (form.get("kind") as "holdings" | "activities")
        : "auto";
    const defaultExchange = optionalFormText(form.get("defaultExchange"));
    const defaultDate = optionalFormText(form.get("defaultDate"));
    const dateOrder =
      form.get("dateOrder") === "DMY" || form.get("dateOrder") === "YMD"
        ? (form.get("dateOrder") as "DMY" | "YMD")
        : "MDY";
    const defaultFxRate = parsePositiveNumber(
      form.get("defaultFxRate"),
      "defaultFxRate",
      false,
    );
    const normalizationOptions = {
      kind: requestedKind,
      scope,
      accountCurrency: "CAD",
      defaultExchange,
      defaultDate: requestedKind === "holdings" ? defaultDate : undefined,
      dateOrder,
      existingImports: existingRows.flatMap((row) =>
        row.importId
          ? [{ importId: row.importId, rowHash: row.rowHash ?? undefined }]
          : [],
      ),
    } as const;
    let result = normalizeWealthsimpleCsv(csv, normalizationOptions);
    if (
      requestedKind === "auto" &&
      result.kind === "holdings" &&
      defaultDate
    ) {
      result = normalizeWealthsimpleCsv(csv, {
        ...normalizationOptions,
        defaultDate,
      });
    }

    const mapped = result.records.map((record) =>
      validateMappedRecord(mapImportedRecord(record, defaultFxRate)),
    );
    const safety = assessImportSafety(
      result.kind,
      mapped.map((item) => ({
        record: item.record,
        values: item.values as LedgerImportValues | null,
      })),
      existingRows,
    );
    const hasGlobalBlock = safety.globalIssues.some(
      (issue) => issue.severity === "error",
    );
    const mappedWithSafety = mapped.map((item) => ({
      ...item,
      issues: [
        ...item.issues,
        ...(safety.issuesByRow.get(item.record.rowNumber) ?? []),
      ],
    }));
    const serverIssues = [
      ...safety.globalIssues,
      ...mappedWithSafety.flatMap((item) => item.issues),
    ];
    const importable = mapped.flatMap((item) =>
      item.values &&
      !hasGlobalBlock &&
      (safety.issuesByRow.get(item.record.rowNumber) ?? []).every(
        (issue) => issue.severity !== "error",
      ) &&
      item.issues.every((issue) => issue.severity !== "error")
        ? [{ record: item.record, values: item.values }]
        : [],
    );
    const fingerprint = importSha256(`${scope}|${csv}`);
    const previewFingerprint = importSha256(
      JSON.stringify({
        fingerprint,
        requestedKind,
        defaultExchange: defaultExchange ?? null,
        defaultDate: defaultDate ?? null,
        dateOrder,
        defaultFxRate,
      }),
    );
    const previewRows: LedgerImportPreviewRow[] = mappedWithSafety.map(
      (item) => ({
        rowNumber: item.record.rowNumber,
        importId: item.record.importId,
        sourceKind: item.record.kind,
        status:
          !hasGlobalBlock &&
          item.values &&
          item.issues.every((issue) => issue.severity !== "error")
            ? "ready"
            : "blocked",
        transaction: item.values
          ? toPreviewTransaction(item.values as LedgerImportValues)
          : null,
        issues: item.issues,
      }),
    );

    if (mode === "preview") {
      return Response.json({
        mode,
        result,
        serverIssues,
        previewRows,
        previewFingerprint,
        importableRows: importable.length,
        originalFileRetained: false,
      });
    }
    if (form.get("confirm") !== "IMPORT_REVIEWED") {
      throw new ApiError(
        "Preview and confirm the reconciliation before importing.",
        409,
        "PREVIEW_REQUIRED",
      );
    }
    if (form.get("previewFingerprint") !== previewFingerprint) {
      throw new ApiError(
        "The file or import options changed after preview. Preview again before committing.",
        409,
        "PREVIEW_CHANGED",
      );
    }
    const blockingIssues = [
      ...result.errors,
      ...serverIssues.filter((issue) => issue.severity === "error"),
    ];
    if (
      blockingIssues.length > 0 &&
      form.get("allowPartial") !== "true"
    ) {
      throw new ApiError(
        "The CSV still has blocking rows. Review them or explicitly allow a partial import.",
        422,
        "IMPORT_HAS_ERRORS",
        { issues: blockingIssues },
      );
    }
    if (importable.length === 0) {
      throw new ApiError(
        "No new normalized rows are ready to import. Resolve the blocked rows or keep the existing duplicates.",
        422,
        "NO_IMPORTABLE_ROWS",
      );
    }
    if (importable.length > MAX_ATOMIC_IMPORT_ROWS) {
      throw new ApiError(
        `This commit has ${importable.length} new rows. Split the CSV into files of at most ${MAX_ATOMIC_IMPORT_ROWS} new rows so each import and reconciliation reset can remain atomic.`,
        422,
        "IMPORT_TOO_LARGE_FOR_ATOMIC_COMMIT",
      );
    }

    const pendingRows = importable.map((item) => {
      const values = validateTransactionInput(item.values);
      return {
        id: newId("txn"),
        ownerEmail: auth.ownerEmail,
        ...values,
        importId: item.record.importId,
        importRowHash: item.record.rowHash,
      };
    });
    const insertQueries = chunk(pendingRows, IMPORT_INSERT_CHUNK_SIZE).map(
      (rows) =>
        db
        .insert(transactions)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: transactions.id }),
    );
    const pendingIdsJson = JSON.stringify(pendingRows.map((row) => row.id));
    const insertedRowsCount = sql<number>`(
      SELECT COUNT(*) FROM ${transactions}
      WHERE ${transactions.ownerEmail} = ${auth.ownerEmail}
        AND ${transactions.id} IN (SELECT value FROM json_each(${pendingIdsJson}))
    )`;
    const sourceDuplicateRows = result.rows.filter(
      (row) => row.status === "duplicate",
    ).length;
    const batchInsert = db
      .insert(importBatches)
      .values({
        id: newId("imp"),
        ownerEmail: auth.ownerEmail,
        fingerprint,
        kind: result.kind ?? "unknown",
        fileName: sanitizeFileName(file.name),
        importedRows: insertedRowsCount,
        rejectedRows:
          result.rows.filter((row) => row.status === "rejected").length +
          result.rows.filter((row) => row.status === "conflict").length +
          previewRows.filter((row) => row.status === "blocked").length,
        duplicateRows: sql<number>`${sourceDuplicateRows + pendingRows.length} - ${insertedRowsCount}`,
        reconciliationJson: JSON.stringify({
          ...result.reconciliation,
          serverIssues,
          originalFileRetained: false,
        }),
      })
      .onConflictDoNothing();
    const invalidateReconciliation = db
      .update(ownerSettings)
      .set({
        ledgerReconciledAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(ownerSettings.ownerEmail, auth.ownerEmail),
          sql`EXISTS (
            SELECT 1 FROM ${transactions}
            WHERE ${transactions.ownerEmail} = ${auth.ownerEmail}
              AND ${transactions.id} IN (SELECT value FROM json_each(${pendingIdsJson}))
          )`,
        ),
      );
    const firstInsertQuery = insertQueries[0];
    if (!firstInsertQuery) {
      throw new Error("Atomic import requires at least one insert query.");
    }
    const atomicQueries = [
      firstInsertQuery,
      ...insertQueries.slice(1),
      batchInsert,
      invalidateReconciliation,
    ] as const;
    const atomicResults = await db.batch(atomicQueries);
    const inserted = atomicResults
      .slice(0, insertQueries.length)
      .reduce<number>(
        (count, rows) => count + (Array.isArray(rows) ? rows.length : 0),
        0,
      );

    return Response.json(
      {
        mode,
        insertedRows: inserted,
        duplicateRows:
          importable.length - inserted +
          result.rows.filter((row) => row.status === "duplicate").length,
        result,
        serverIssues,
        previewRows,
        previewFingerprint,
        originalFileRetained: false,
        usdAccountEnabled: settings.usdAccountEnabled,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function mapImportedRecord(
  record: NormalizedWealthsimpleRecord,
  defaultFxRate: number | null,
): {
  record: NormalizedWealthsimpleRecord;
  values: Record<string, unknown> | null;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const issue = (message: string, field?: string) =>
    issues.push({
      severity: "error",
      code: "PERSISTENCE_REQUIREMENT",
      message,
      rowNumber: record.rowNumber,
      field,
    });
  const fxRate =
    record.currency === "CAD"
      ? 1
      : record.kind === "activity"
        ? (record.fxRate ?? defaultFxRate)
        : defaultFxRate;
  if (record.currency === "USD" && !fxRate) {
    issue("A CAD-per-USD FX rate is required for every USD row.", "fxRate");
  }

  if (record.kind === "holding") {
    if (record.averageCost === undefined) {
      issue("Average cost is required to create an opening position.", "averageCost");
    }
    if (!record.asOfDate) {
      issue("An as-of date is required for an opening position.", "date");
    }
    return {
      record,
      issues,
      values:
        issues.length === 0
          ? {
              action: "BUY",
              canonicalSymbol: record.symbol,
              exchange: record.exchange,
              quantity: record.quantity,
              price: record.averageCost,
              currency: record.currency,
              fee: 0,
              fxRateToCad: fxRate,
              occurredAt: `${record.asOfDate}T12:00:00.000Z`,
              notes: "Opening position from Wealthsimple holdings CSV",
            }
          : null,
    };
  }

  const common = {
    canonicalSymbol: record.symbol,
    exchange: record.exchange,
    quantity: record.quantity ?? 1,
    price: record.price,
    currency: record.currency,
    fee: record.fee,
    fxRateToCad: fxRate,
    occurredAt: `${record.date}T12:00:00.000Z`,
    notes: "Imported from Wealthsimple activity CSV",
  };
  let values: Record<string, unknown> | null = null;
  if (record.activityType === "BUY" || record.activityType === "SELL") {
    values = { ...common, action: record.activityType };
  } else if (record.activityType === "DIVIDEND") {
    if (!record.symbol || !record.exchange || record.amount === undefined) {
      issue(
        "Dividend rows require a symbol, exchange, and gross amount.",
        "amount",
      );
    } else {
      values = {
        ...common,
        action: "DIVIDEND",
        quantity: 1,
        price: Math.abs(record.amount),
        fee: 0,
      };
    }
  } else if (
    record.activityType === "DEPOSIT" ||
    record.activityType === "WITHDRAWAL"
  ) {
    if (record.amount === undefined) {
      issue("Cash-flow rows require an amount.", "amount");
    } else {
      const amountCad = Math.abs(record.amount) * (fxRate ?? 1);
      values = {
        action:
          record.activityType === "DEPOSIT"
            ? "CONTRIBUTION"
            : "WITHDRAWAL",
        canonicalSymbol: "CASH",
        exchange: "CASH",
        quantity: 1,
        price: amountCad,
        currency: "CAD",
        fee: 0,
        fxRateToCad: 1,
        occurredAt: common.occurredAt,
        notes: "TFSA flow imported from Wealthsimple activity CSV",
      };
    }
  } else if (record.activityType === "FEE") {
    const amount = Math.abs(record.amount ?? record.fee);
    if (!amount) issue("Fee rows require a non-zero amount.", "amount");
    else {
      values = {
        action: "FEE",
        canonicalSymbol: "CASH",
        exchange: "CASH",
        quantity: 1,
        price: amount,
        currency: record.currency,
        fee: 0,
        fxRateToCad: fxRate,
        occurredAt: common.occurredAt,
        notes: "Fee imported from Wealthsimple activity CSV",
      };
    }
  } else if (record.activityType === "FX_CONVERSION") {
    const amount = Math.abs(record.amount ?? 0);
    if (!amount) issue("FX conversion rows require an amount.", "amount");
    else {
      values = {
        action: "FX_CONVERSION",
        canonicalSymbol: "CASH",
        exchange: "CASH",
        quantity: 1,
        price: amount,
        currency: record.currency,
        fee: record.fee,
        fxRateToCad: fxRate,
        occurredAt: common.occurredAt,
        notes: "FX conversion imported from Wealthsimple activity CSV",
      };
    }
  } else {
    issues.push({
      severity: "error",
      code: "MANUAL_CLASSIFICATION_REQUIRED",
      message:
        "This activity type requires manual classification before it can affect the TFSA ledger.",
      rowNumber: record.rowNumber,
      field: "activityType",
    });
  }
  return { record, values, issues };
}

function validateMappedRecord(item: ReturnType<typeof mapImportedRecord>) {
  if (
    !item.values ||
    item.issues.some((issue) => issue.severity === "error")
  ) {
    return item;
  }
  try {
    return { ...item, values: validateTransactionInput(item.values) };
  } catch (error) {
    const validationIssue: ImportIssue = {
      severity: "error",
      code: "LEDGER_VALIDATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "The normalized row is not valid for the portfolio ledger.",
      rowNumber: item.record.rowNumber,
    };
    return {
      ...item,
      values: null,
      issues: [...item.issues, validationIssue],
    };
  }
}

function toPreviewTransaction(
  values: LedgerImportValues,
): LedgerImportPreviewRow["transaction"] {
  return {
    action: values.action,
    canonicalSymbol: values.canonicalSymbol,
    exchange: values.exchange,
    quantity: values.quantity,
    price: values.price,
    currency: values.currency === "USD" ? "USD" : "CAD",
    fee: values.fee,
    fxRateToCad: values.fxRateToCad,
    occurredAt: values.occurredAt,
  };
}

function optionalFormText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePositiveNumber(
  value: FormDataEntryValue | null,
  field: string,
  required: boolean,
): number | null {
  if (value === null || value === "") {
    if (required) throw new ApiError(`${field} is required.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(`${field} must be greater than zero.`);
  }
  return parsed;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 120);
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
