export type PaperTradePerformanceInput = {
  id: string;
  status: string;
  action: string;
  quantity: number;
  decisionTime: string;
  hypotheticalFillTime: string | null;
  hypotheticalFillPrice: number | null;
  fxRateToCad: number;
  feesCad: number;
};

export type PaperMarkPerformanceInput = {
  paperTradeId: string;
  observedAt: string;
  price: number;
  fxRateToCad: number;
};

export type BenchmarkMarkPerformanceInput = {
  observedAt: string;
  price: number;
  fxRateToCad: number;
};

export type PaperOutcome = {
  paperTradeId: string;
  markedAt: string | null;
  markPrice: number | null;
  afterFeeProfitCad: number | null;
  afterFeeReturnPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
};

export function calculatePaperPerformance(
  rows: PaperTradePerformanceInput[],
  marks: PaperMarkPerformanceInput[],
  benchmarkMarks: BenchmarkMarkPerformanceInput[],
) {
  const queued = rows.filter((row) => row.status === "queued");
  const filled = rows.filter(
    (row) =>
      row.status === "filled" &&
      row.hypotheticalFillPrice !== null &&
      row.hypotheticalFillTime,
  );
  const marksByTrade = new Map<string, PaperMarkPerformanceInput[]>();
  for (const mark of marks) {
    const bucket = marksByTrade.get(mark.paperTradeId) ?? [];
    bucket.push(mark);
    marksByTrade.set(mark.paperTradeId, bucket);
  }

  let capitalCad = 0;
  let afterFeeProfitCad = 0;
  let benchmarkProfitCad = 0;
  let benchmarkCapitalCad = 0;
  let estimatedFxCostsCad = 0;
  let turnoverCad = 0;
  const outcomes: PaperOutcome[] = [];

  for (const trade of filled) {
    const fillPrice = trade.hypotheticalFillPrice!;
    const fillTime = trade.hypotheticalFillTime!;
    const fillFx = trade.fxRateToCad;
    const basisCad = fillPrice * trade.quantity * fillFx;
    const direction = trade.action === "exit-candidate" ? -1 : 1;
    const tradeMarks = (marksByTrade.get(trade.id) ?? [])
      .filter((mark) => Date.parse(mark.observedAt) >= Date.parse(fillTime))
      .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const latestMark = tradeMarks.at(-1) ?? null;
    capitalCad += basisCad;
    turnoverCad += basisCad;
    estimatedFxCostsCad += trade.feesCad;

    let profit: number | null = null;
    let tradeReturn: number | null = null;
    if (latestMark) {
      const markedCad =
        latestMark.price * trade.quantity * latestMark.fxRateToCad;
      profit = direction * (markedCad - basisCad) - trade.feesCad;
      tradeReturn = basisCad > 0 ? (profit / basisCad) * 100 : null;
      afterFeeProfitCad += profit;
    }

    const benchmarkFill = benchmarkMarks.find(
      (mark) => Date.parse(mark.observedAt) > Date.parse(fillTime),
    );
    const benchmarkLatest = benchmarkMarks.at(-1);
    let benchmarkReturn: number | null = null;
    if (
      benchmarkFill &&
      benchmarkLatest &&
      Date.parse(benchmarkLatest.observedAt) >=
        Date.parse(benchmarkFill.observedAt)
    ) {
      const benchmarkStart =
        benchmarkFill.price * benchmarkFill.fxRateToCad;
      const benchmarkEnd =
        benchmarkLatest.price * benchmarkLatest.fxRateToCad;
      benchmarkReturn =
        benchmarkStart > 0
          ? direction * ((benchmarkEnd - benchmarkStart) / benchmarkStart) * 100
          : null;
      if (benchmarkReturn !== null) {
        benchmarkCapitalCad += basisCad;
        benchmarkProfitCad += basisCad * (benchmarkReturn / 100);
      }
    }

    outcomes.push({
      paperTradeId: trade.id,
      markedAt: latestMark?.observedAt ?? null,
      markPrice: latestMark?.price ?? null,
      afterFeeProfitCad: profit === null ? null : round(profit),
      afterFeeReturnPct:
        tradeReturn === null ? null : round(tradeReturn, 4),
      benchmarkReturnPct:
        benchmarkReturn === null ? null : round(benchmarkReturn, 4),
      excessReturnPct:
        tradeReturn === null || benchmarkReturn === null
          ? null
          : round(tradeReturn - benchmarkReturn, 4),
    });
  }

  return {
    outcomes,
    metrics: {
      totalDecisions: rows.length,
      queuedFills: queued.length,
      filledDecisions: filled.length,
      markedDecisions: outcomes.filter(
        (outcome) => outcome.afterFeeReturnPct !== null,
      ).length,
      calendarDays:
        rows.length > 0
          ? Math.max(
              0,
              Math.floor(
                (Date.now() -
                  Math.min(...rows.map((row) => Date.parse(row.decisionTime)))) /
                  86_400_000,
              ),
            )
          : 0,
      capitalTrackedCad: round(capitalCad),
      turnoverCad: round(turnoverCad),
      afterFeeProfitCad: round(afterFeeProfitCad),
      afterFeeReturnPct:
        capitalCad > 0 ? round((afterFeeProfitCad / capitalCad) * 100, 4) : null,
      benchmarkReturnPct:
        benchmarkCapitalCad > 0
          ? round((benchmarkProfitCad / benchmarkCapitalCad) * 100, 4)
          : null,
      excessReturnPct:
        capitalCad > 0 && benchmarkCapitalCad > 0
          ? round(
              (afterFeeProfitCad / capitalCad -
                benchmarkProfitCad / benchmarkCapitalCad) *
                100,
              4,
            )
          : null,
      maxDrawdownPct: calculateDrawdown(filled, marksByTrade),
      estimatedFxCostsCad: round(estimatedFxCostsCad),
    },
  };
}

function calculateDrawdown(
  trades: PaperTradePerformanceInput[],
  marksByTrade: Map<string, PaperMarkPerformanceInput[]>,
): number | null {
  const timestamps = [
    ...new Set(
      [...marksByTrade.values()]
        .flat()
        .map((mark) => mark.observedAt)
        .filter((value) => Number.isFinite(Date.parse(value))),
    ),
  ].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (timestamps.length === 0) return null;

  let peak = 0;
  let worst = 0;
  for (const timestamp of timestamps) {
    let equity = 0;
    for (const trade of trades) {
      if (
        !trade.hypotheticalFillTime ||
        trade.hypotheticalFillPrice === null ||
        Date.parse(trade.hypotheticalFillTime) > Date.parse(timestamp)
      ) {
        continue;
      }
      const direction = trade.action === "exit-candidate" ? -1 : 1;
      const basis =
        trade.hypotheticalFillPrice * trade.quantity * trade.fxRateToCad;
      const mark = (marksByTrade.get(trade.id) ?? [])
        .filter((item) => Date.parse(item.observedAt) <= Date.parse(timestamp))
        .sort(
          (left, right) =>
            Date.parse(left.observedAt) - Date.parse(right.observedAt),
        )
        .at(-1);
      const marked = mark
        ? mark.price * trade.quantity * mark.fxRateToCad
        : basis;
      equity += basis + direction * (marked - basis) - trade.feesCad;
    }
    if (equity <= 0) continue;
    peak = Math.max(peak, equity);
    if (peak > 0) worst = Math.min(worst, ((equity - peak) / peak) * 100);
  }
  return round(worst, 4);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
