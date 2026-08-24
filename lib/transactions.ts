import { and, desc, eq, exists } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { ownerSettings, transactions } from "@/db/schema";
import { ApiError, clampNumber, cleanText } from "./http";
import { newId } from "./ids";

export const TRANSACTION_ACTIONS = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "FEE",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "FX_CONVERSION",
] as const;
export type TransactionAction = (typeof TRANSACTION_ACTIONS)[number];
export type TransactionCurrency = "CAD" | "USD";

export type TransactionRecord = {
  id: string;
  action: TransactionAction;
  canonicalSymbol: string;
  exchange: string;
  quantity: number;
  price: number;
  currency: TransactionCurrency;
  fee: number;
  fxRateToCad: number;
  occurredAt: string;
  importId: string | null;
  importRowHash: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export async function listTransactions(
  ownerEmail: string,
  limit = 500,
): Promise<TransactionRecord[]> {
  const db = await getReadyDb();
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.ownerEmail, ownerEmail))
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 2_000));
  return rows.map(mapTransaction);
}

export async function createTransaction(
  ownerEmail: string,
  input: Record<string, unknown>,
): Promise<TransactionRecord> {
  const values = validateTransactionInput(input);
  const db = await getReadyDb();
  const id = newId("txn");
  const now = new Date().toISOString();
  const [, createdRows] = await db.batch([
    db.insert(ownerSettings).values({ ownerEmail }).onConflictDoNothing(),
    db
      .insert(transactions)
      .values({ id, ownerEmail, ...values })
      .returning(),
    db
      .update(ownerSettings)
      .set({ ledgerReconciledAt: null, updatedAt: now })
      .where(eq(ownerSettings.ownerEmail, ownerEmail)),
  ]);
  const [created] = createdRows;
  if (!created) throw new Error("Unable to save the transaction.");
  return mapTransaction(created);
}

export async function updateTransaction(
  ownerEmail: string,
  id: string,
  input: Record<string, unknown>,
): Promise<TransactionRecord> {
  const values = validateTransactionInput(input);
  const db = await getReadyDb();
  const now = new Date().toISOString();
  const target = and(
    eq(transactions.ownerEmail, ownerEmail),
    eq(transactions.id, id),
  );
  const [, , updatedRows] = await db.batch([
    db.insert(ownerSettings).values({ ownerEmail }).onConflictDoNothing(),
    db
      .update(ownerSettings)
      .set({ ledgerReconciledAt: null, updatedAt: now })
      .where(
        and(
          eq(ownerSettings.ownerEmail, ownerEmail),
          exists(
            db
              .select({ id: transactions.id })
              .from(transactions)
              .where(target),
          ),
        ),
      ),
    db
      .update(transactions)
      .set({ ...values, updatedAt: now })
      .where(target)
      .returning(),
  ]);
  const [updated] = updatedRows;
  if (!updated) throw new ApiError("Transaction not found.", 404, "NOT_FOUND");
  return mapTransaction(updated);
}

export async function deleteTransaction(
  ownerEmail: string,
  id: string,
): Promise<void> {
  const db = await getReadyDb();
  const now = new Date().toISOString();
  const target = and(
    eq(transactions.ownerEmail, ownerEmail),
    eq(transactions.id, id),
  );
  const [, , deleted] = await db.batch([
    db.insert(ownerSettings).values({ ownerEmail }).onConflictDoNothing(),
    db
      .update(ownerSettings)
      .set({ ledgerReconciledAt: null, updatedAt: now })
      .where(
        and(
          eq(ownerSettings.ownerEmail, ownerEmail),
          exists(
            db
              .select({ id: transactions.id })
              .from(transactions)
              .where(target),
          ),
        ),
      ),
    db
      .delete(transactions)
      .where(target)
      .returning({ id: transactions.id }),
  ]);
  if (!deleted[0]) {
    throw new ApiError("Transaction not found.", 404, "NOT_FOUND");
  }
}

export function validateTransactionInput(input: Record<string, unknown>) {
  const action = cleanText(input.action, "action", 30).toUpperCase();
  if (!TRANSACTION_ACTIONS.includes(action as TransactionAction)) {
    throw new ApiError("Unsupported transaction action.");
  }
  const cashFlow =
    action === "CONTRIBUTION" ||
    action === "WITHDRAWAL" ||
    action === "FX_CONVERSION";
  const feeOnly = action === "FEE";
  const canonicalSymbol = cashFlow || feeOnly
    ? "CASH"
    : canonicalizeSymbol(cleanText(input.canonicalSymbol, "canonicalSymbol"));
  const exchange = cashFlow || feeOnly
    ? "CASH"
    : normalizeExchange(cleanText(input.exchange, "exchange", 20));
  const currency = cleanText(input.currency, "currency", 3).toUpperCase();
  if (currency !== "CAD" && currency !== "USD") {
    throw new ApiError("currency must be CAD or USD.");
  }
  const occurredAtRaw = cleanText(input.occurredAt, "occurredAt", 50);
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ApiError("occurredAt must be a valid date and time.");
  }
  return {
    action,
    canonicalSymbol,
    exchange,
    quantity: clampNumber(input.quantity, 0, 1_000_000_000, "quantity"),
    price: clampNumber(input.price, 0, 1_000_000_000, "price"),
    currency,
    fee: clampNumber(input.fee ?? 0, 0, 1_000_000, "fee"),
    fxRateToCad: clampNumber(
      input.fxRateToCad ?? (currency === "CAD" ? 1 : 1.35),
      0.01,
      100,
      "fxRateToCad",
    ),
    occurredAt: occurredAt.toISOString(),
    importId:
      typeof input.importId === "string" && input.importId.trim()
        ? input.importId.trim().slice(0, 200)
        : null,
    importRowHash:
      typeof input.importRowHash === "string" && input.importRowHash.trim()
        ? input.importRowHash.trim().slice(0, 128)
        : null,
    notes:
      typeof input.notes === "string"
        ? input.notes
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, 500)
        : "",
  };
}

export function canonicalizeSymbol(value: string): string {
  const symbol = value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9.\-]/g, "");
  if (!symbol || symbol.length > 20) {
    throw new ApiError("Ticker symbol is invalid.");
  }
  return symbol;
}

export function normalizeExchange(value: string): string {
  const normalized = value.toUpperCase().replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    TSE: "TSX",
    TORONTO: "TSX",
    TSXV: "TSXV",
    NASDAQGS: "NASDAQ",
    NASDAQGM: "NASDAQ",
    NEW_YORK_STOCK_EXCHANGE: "NYSE",
  };
  const exchange = aliases[normalized] ?? normalized;
  if (!["TSX", "TSXV", "NYSE", "NASDAQ"].includes(exchange)) {
    throw new ApiError("Exchange must be TSX, TSXV, NYSE, or NASDAQ.");
  }
  return exchange;
}

function mapTransaction(
  row: typeof transactions.$inferSelect,
): TransactionRecord {
  return {
    id: row.id,
    action: row.action as TransactionAction,
    canonicalSymbol: row.canonicalSymbol,
    exchange: row.exchange,
    quantity: row.quantity,
    price: row.price,
    currency: row.currency as TransactionCurrency,
    fee: row.fee,
    fxRateToCad: row.fxRateToCad,
    occurredAt: row.occurredAt,
    importId: row.importId,
    importRowHash: row.importRowHash,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
