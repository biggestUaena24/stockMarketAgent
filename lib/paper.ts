import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { getReadyDb } from "@/db";
import {
  paperBenchmarkMarks,
  paperMarks,
  paperTrades,
} from "@/db/schema";
import { newId } from "./ids";
import { calculatePaperPerformance } from "./paper-performance";

export { calculatePaperPerformance } from "./paper-performance";

export async function settleQueuedPaperTrades(input: {
  ownerEmail: string;
  symbol: string;
  observedPrice: number;
  observedAt: string;
}): Promise<number> {
  if (
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !Number.isFinite(input.observedPrice) ||
    input.observedPrice <= 0
  ) {
    return 0;
  }
  const db = await getReadyDb();
  const queued = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.ownerEmail, input.ownerEmail),
        eq(paperTrades.canonicalSymbol, input.symbol),
        eq(paperTrades.status, "queued"),
        isNull(paperTrades.hypotheticalFillPrice),
      ),
    );
  let settled = 0;
  for (const trade of queued) {
    if (Date.parse(input.observedAt) <= Date.parse(trade.decisionTime)) continue;
    await db
      .update(paperTrades)
      .set({
        hypotheticalFillTime: input.observedAt,
        hypotheticalFillPrice: input.observedPrice,
        status: "filled",
      })
      .where(eq(paperTrades.id, trade.id));
    settled += 1;
  }
  return settled;
}

export async function recordPaperObservation(input: {
  ownerEmail: string;
  symbol: string;
  observedPrice: number;
  observedAt: string;
  fxRateToCad: number;
}): Promise<number> {
  if (
    !validObservation(
      input.observedPrice,
      input.fxRateToCad,
      input.observedAt,
    )
  ) {
    return 0;
  }
  const db = await getReadyDb();
  const filled = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.ownerEmail, input.ownerEmail),
        eq(paperTrades.canonicalSymbol, input.symbol),
        eq(paperTrades.status, "filled"),
        lte(paperTrades.hypotheticalFillTime, input.observedAt),
      ),
    );
  let inserted = 0;
  for (const trade of filled) {
    const existing = await db
      .select({ id: paperMarks.id })
      .from(paperMarks)
      .where(
        and(
          eq(paperMarks.paperTradeId, trade.id),
          eq(paperMarks.observedAt, input.observedAt),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    await db.insert(paperMarks).values({
      id: newId("mark"),
      ownerEmail: input.ownerEmail,
      paperTradeId: trade.id,
      observedAt: input.observedAt,
      price: input.observedPrice,
      fxRateToCad: input.fxRateToCad,
    });
    inserted += 1;
  }
  return inserted;
}

export async function recordBenchmarkObservation(input: {
  ownerEmail: string;
  symbol: string;
  observedPrice: number;
  observedAt: string;
  fxRateToCad: number;
}): Promise<boolean> {
  if (
    !validObservation(
      input.observedPrice,
      input.fxRateToCad,
      input.observedAt,
    )
  ) {
    return false;
  }
  const db = await getReadyDb();
  const existing = await db
    .select({ id: paperBenchmarkMarks.id })
    .from(paperBenchmarkMarks)
    .where(
      and(
        eq(paperBenchmarkMarks.ownerEmail, input.ownerEmail),
        eq(paperBenchmarkMarks.canonicalSymbol, input.symbol),
        eq(paperBenchmarkMarks.observedAt, input.observedAt),
      ),
    )
    .limit(1);
  if (existing[0]) return false;
  await db.insert(paperBenchmarkMarks).values({
    id: newId("benchmark"),
    ownerEmail: input.ownerEmail,
    canonicalSymbol: input.symbol,
    observedAt: input.observedAt,
    price: input.observedPrice,
    fxRateToCad: input.fxRateToCad,
  });
  return true;
}

export async function queuePaperDecision(input: {
  ownerEmail: string;
  recommendationId: string;
  symbol: string;
  action: "consider-candidate" | "exit-candidate";
  quantity: number;
  decisionPrice: number;
  currency: "CAD" | "USD";
  fxRateToCad: number;
  decisionTime: string;
  feesCad: number;
}): Promise<void> {
  if (
    !validObservation(
      input.decisionPrice,
      input.fxRateToCad,
      input.decisionTime,
    ) ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isFinite(input.feesCad) ||
    input.feesCad < 0
  ) {
    throw new Error("Paper decision values are invalid.");
  }
  const db = await getReadyDb();
  const existing = await db
    .select({ id: paperTrades.id })
    .from(paperTrades)
    .where(eq(paperTrades.recommendationId, input.recommendationId))
    .limit(1);
  if (existing[0]) return;
  await db.insert(paperTrades).values({
    id: newId("paper"),
    ownerEmail: input.ownerEmail,
    recommendationId: input.recommendationId,
    canonicalSymbol: input.symbol,
    action: input.action,
    quantity: input.quantity,
    decisionPrice: input.decisionPrice,
    decisionCurrency: input.currency,
    fxRateToCad: input.fxRateToCad,
    decisionTime: input.decisionTime,
    feesCad: input.feesCad,
    benchmarkSymbol: "XGRO.TO",
    status: "queued",
  });
}

export async function getPaperPerformance(ownerEmail: string) {
  const db = await getReadyDb();
  const [rows, marks, benchmarkMarks] = await Promise.all([
    db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.ownerEmail, ownerEmail))
      .orderBy(desc(paperTrades.decisionTime))
      .limit(500),
    db
      .select()
      .from(paperMarks)
      .where(eq(paperMarks.ownerEmail, ownerEmail))
      .orderBy(asc(paperMarks.observedAt))
      .limit(10_000),
    db
      .select()
      .from(paperBenchmarkMarks)
      .where(
        and(
          eq(paperBenchmarkMarks.ownerEmail, ownerEmail),
          eq(paperBenchmarkMarks.canonicalSymbol, "XGRO.TO"),
        ),
      )
      .orderBy(asc(paperBenchmarkMarks.observedAt))
      .limit(5_000),
  ]);
  const computed = calculatePaperPerformance(rows, marks, benchmarkMarks);
  return {
    trades: rows.map((row) => ({
      ...row,
      outcome:
        computed.outcomes.find((item) => item.paperTradeId === row.id) ?? null,
    })),
    metrics: {
      ...computed.metrics,
      minimumCalendarDays: 30,
      minimumMarketSessions: 20,
      benchmarkSymbol: "XGRO.TO",
      methodology:
        "A decision is frozen at report time and filled only at the first later observed provider price. Returns use later marks, estimated fees, recorded CAD conversion, and the same-window XGRO benchmark without look-ahead.",
    },
  };
}

function validObservation(
  price: number,
  fxRateToCad: number,
  observedAt: string,
): boolean {
  return (
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(fxRateToCad) &&
    fxRateToCad > 0 &&
    Number.isFinite(Date.parse(observedAt))
  );
}
