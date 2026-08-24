export type ResearchRunAccountingRow = {
  idempotencyKey: string;
  actualTime: string;
  status: string;
  dataFreshness: string;
  errors?: readonly string[];
  errorsJson?: string;
};

export type ResearchRunMarketStateRow = ResearchRunAccountingRow & {
  marketState?: Record<string, unknown>;
  marketStateJson?: string;
};

export type ResearchRunQuality = {
  status: "complete" | "degraded";
  dataFreshness: "verified" | "limited";
};

export type PaperTrialReadiness = {
  startedOn: string | null;
  completedMarketSessions: number;
  scheduledRuns: number;
  successfulRuns: number;
  unresolvedDataQualityFailures: number;
};

const scheduledRunKey = /^\d{4}-\d{2}-\d{2}:(morning|evening)$/;

export function isScheduledResearchRun(
  run: Pick<ResearchRunAccountingRow, "idempotencyKey">,
): boolean {
  return scheduledRunKey.test(run.idempotencyKey);
}

export function paperTrialScheduledRuns<T extends ResearchRunAccountingRow>(
  runs: readonly T[],
  paperTrialStartedAt: string | null,
): T[] {
  if (!paperTrialStartedAt) return [];
  const started = Date.parse(paperTrialStartedAt);
  if (!Number.isFinite(started)) return [];

  return runs.filter(
    (run) =>
      isScheduledResearchRun(run) &&
      Number.isFinite(Date.parse(run.actualTime)) &&
      Date.parse(run.actualTime) >= started,
  );
}

export function isSuccessfulResearchRun(
  run: Pick<
    ResearchRunAccountingRow,
    "status" | "dataFreshness" | "errors" | "errorsJson"
  >,
): boolean {
  return (
    run.status === "complete" &&
    run.dataFreshness === "verified" &&
    researchDiagnostics(run).length === 0
  );
}

export function isDataQualityFailure(
  run: Pick<
    ResearchRunAccountingRow,
    "status" | "dataFreshness" | "errors" | "errorsJson"
  >,
): boolean {
  if (run.status === "running") return false;
  return (
    run.status !== "complete" ||
    run.dataFreshness !== "verified" ||
    researchDiagnostics(run).length > 0
  );
}

export function assessResearchRunQuality(input: {
  providerConfigured: boolean;
  acceptedSymbolCount: number;
  recommendationCount: number;
  blockedByDataCount: number;
  researchDiagnostics: readonly string[];
  portfolioDiagnostics: readonly string[];
}): ResearchRunQuality {
  const complete =
    input.providerConfigured &&
    input.acceptedSymbolCount > 0 &&
    input.recommendationCount > 0 &&
    input.blockedByDataCount === 0 &&
    input.researchDiagnostics.length === 0 &&
    input.portfolioDiagnostics.length === 0;
  return complete
    ? { status: "complete", dataFreshness: "verified" }
    : { status: "degraded", dataFreshness: "limited" };
}

export function completedMarketSessionDates(
  runs: readonly ResearchRunMarketStateRow[],
): string[] {
  const dates = new Set<string>();
  for (const run of runs) {
    if (!isSuccessfulResearchRun(run)) continue;
    const state = savedMarketState(run);
    if (
      state?.anyOpen === true &&
      typeof state.localDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(state.localDate)
    ) {
      dates.add(state.localDate);
    }
  }
  return [...dates].sort();
}

export function summarizePaperTrialReadiness(
  rows: readonly ResearchRunMarketStateRow[],
  paperTrialStartedAt: string | null,
): PaperTrialReadiness {
  const scheduled = paperTrialScheduledRuns(rows, paperTrialStartedAt);
  const successful = scheduled.filter(isSuccessfulResearchRun);
  return {
    startedOn: paperTrialStartedAt,
    completedMarketSessions: completedMarketSessionDates(scheduled).length,
    scheduledRuns: scheduled.length,
    successfulRuns: successful.length,
    unresolvedDataQualityFailures: scheduled.filter(isDataQualityFailure).length,
  };
}

export function researchDiagnostics(
  run: Pick<ResearchRunAccountingRow, "errors" | "errorsJson">,
): string[] {
  const errors = run.errors ?? parseErrors(run.errorsJson);
  return errors.filter((diagnostic) => !isNotificationDiagnostic(diagnostic));
}

export function isNotificationDiagnostic(diagnostic: string): boolean {
  return /^(?:email delivery|notification(?: delivery)?):/i.test(
    diagnostic.trim(),
  );
}

function parseErrors(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return ["Research diagnostics could not be read."];
  }
}

function savedMarketState(
  run: Pick<ResearchRunMarketStateRow, "marketState" | "marketStateJson">,
): Record<string, unknown> | null {
  if (run.marketState && !Array.isArray(run.marketState)) {
    return run.marketState;
  }
  if (!run.marketStateJson) return null;
  try {
    const parsed = JSON.parse(run.marketStateJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
