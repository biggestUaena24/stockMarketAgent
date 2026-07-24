import { desc, eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { importBatches, transactions } from "@/db/schema";
import { requireApiOwner } from "@/lib/api-context";
import { ApiError, errorResponse } from "@/lib/http";
import {
  normalizeWealthsimpleCsv,
  sha256 as importSha256,
  type ImportIssue,
  type NormalizedWealthsimpleRecord,
} from "@/lib/import";
import { newId } from "@/lib/ids";
import { getOrCreateSettings } from "@/lib/settings";
import { validateTransactionInput } from "@/lib/transactions";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

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
        importId: transactions.importId,
        rowHash: transactions.importRowHash,
      })
      .from(transactions)
      .where(eq(transactions.ownerEmail, auth.ownerEmail));
    const csv = await file.text();
    const scope = importSha256(`cedar|${auth.ownerEmail.toLowerCase()}`);
    const defaultFxRate = parsePositiveNumber(
      form.get("defaultFxRate"),
      "defaultFxRate",
      false,
    );
    const result = normalizeWealthsimpleCsv(csv, {
      kind:
        form.get("kind") === "holdings" || form.get("kind") === "activities"
          ? (form.get("kind") as "holdings" | "activities")
          : "auto",
      scope,
      accountCurrency: "CAD",
      defaultCurrency: "CAD",
      defaultExchange:
        typeof form.get("defaultExchange") === "string"
          ? String(form.get("defaultExchange"))
          : "TSX",
      defaultDate:
        typeof form.get("defaultDate") === "string" &&
        String(form.get("defaultDate"))
          ? String(form.get("defaultDate"))
          : undefined,
      dateOrder:
        form.get("dateOrder") === "DMY" || form.get("dateOrder") === "YMD"
          ? (form.get("dateOrder") as "DMY" | "YMD")
          : "MDY",
      existingImports: existingRows.flatMap((row) =>
        row.importId
          ? [{ importId: row.importId, rowHash: row.rowHash ?? undefined }]
          : [],
      ),
    });

    const mapped = result.records.map((record) =>
      mapImportedRecord(record, defaultFxRate),
    );
    const serverIssues = mapped.flatMap((item) => item.issues);
    const importable = mapped.flatMap((item) =>
      item.values && item.issues.every((issue) => issue.severity !== "error")
        ? [{ record: item.record, values: item.values }]
        : [],
    );
    const fingerprint = importSha256(`${scope}|${csv}`);

    if (mode === "preview") {
      return Response.json({
        mode,
        result,
        serverIssues,
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

    let inserted = 0;
    for (const item of importable) {
      const values = validateTransactionInput(item.values);
      const write = await db
        .insert(transactions)
        .values({
          id: newId("txn"),
          ownerEmail: auth.ownerEmail,
          ...values,
          importId: item.record.importId,
          importRowHash: item.record.rowHash,
        })
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      inserted += write.length;
    }
    await db
      .insert(importBatches)
      .values({
        id: newId("imp"),
        ownerEmail: auth.ownerEmail,
        fingerprint,
        kind: result.kind ?? "unknown",
        fileName: sanitizeFileName(file.name),
        importedRows: inserted,
        rejectedRows:
          result.rows.filter((row) => row.status === "rejected").length +
          serverIssues.filter((issue) => issue.severity === "error").length,
        duplicateRows: result.rows.filter(
          (row) => row.status === "duplicate",
        ).length,
        reconciliationJson: JSON.stringify({
          ...result.reconciliation,
          serverIssues,
          originalFileRetained: false,
        }),
      })
      .onConflictDoNothing();

    return Response.json(
      {
        mode,
        insertedRows: inserted,
        duplicateRows:
          importable.length - inserted +
          result.rows.filter((row) => row.status === "duplicate").length,
        result,
        serverIssues,
        originalFileRetained: false,
        usdAccountEnabled: settings.usdAccountEnabled,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
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
