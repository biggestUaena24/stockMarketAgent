"use client";

import Link from "next/link";
import { Icon } from "@/app/components/icons";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Metric,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import {
  actionTone,
  dateTime,
  money,
  percent,
  useApi,
} from "@/app/lib/client";
import type { ReportsPayload } from "@/app/lib/view-types";
import type { getPaperPerformance } from "@/lib/paper";
import type { OwnerSettings } from "@/lib/settings";

type PaperPayload = {
  paper: Awaited<ReturnType<typeof getPaperPerformance>>;
};

type SettingsPayload = {
  settings: OwnerSettings;
};

export function PaperScreen() {
  const paperApi = useApi<PaperPayload>("/api/paper");
  const settingsApi = useApi<SettingsPayload>("/api/settings");
  const reportsApi = useApi<ReportsPayload>("/api/reports?limit=100");
  const loading =
    paperApi.loading || settingsApi.loading || reportsApi.loading;
  const error = paperApi.error ?? settingsApi.error ?? reportsApi.error;

  return (
    <>
      <PageHeader
        eyebrow="No-money validation"
        title="Paper-trial performance"
        description="Track what the research system said, then apply only a later observed price. Paper results are a reliability check—not proof of future returns."
        action={
          <Link className="button button-secondary" href="/reports">
            <Icon name="reports" width={17} height={17} />
            Open report history
          </Link>
        }
      />

      {loading ? (
        <LoadingBlock rows={7} />
      ) : error ||
        !paperApi.data ||
        !settingsApi.data ||
        !reportsApi.data ? (
        <ErrorState
          message={error ?? "Paper-trial data is unavailable."}
          onRetry={() => {
            void Promise.all([
              paperApi.reload(),
              settingsApi.reload(),
              reportsApi.reload(),
            ]);
          }}
        />
      ) : (
        <PaperContent
          paper={paperApi.data.paper}
          settings={settingsApi.data.settings}
          reports={reportsApi.data}
        />
      )}
    </>
  );
}

function PaperContent({
  paper,
  settings,
  reports,
}: {
  paper: PaperPayload["paper"];
  settings: OwnerSettings;
  reports: ReportsPayload;
}) {
  const trialRuns = settings.paperTrialStartedAt
    ? reports.reports.filter(
        (run) =>
          Date.parse(run.actualTime) >=
          Date.parse(settings.paperTrialStartedAt ?? ""),
      )
    : [];
  const successfulRuns = trialRuns.filter(
    (run) => run.status === "complete" && run.errors.length === 0,
  );
  const reliability =
    trialRuns.length > 0 ? successfulRuns.length / trialRuns.length : 0;
  const marketSessions = new Set(
    successfulRuns.map((run) => calgaryDateKey(run.actualTime)),
  ).size;
  const calendarDays = settings.paperTrialStartedAt
    ? daysSince(settings.paperTrialStartedAt)
    : 0;
  const unresolvedFailures = trialRuns.filter(
    (run) => run.status !== "complete" || run.errors.length > 0,
  ).length;
  const gates = [
    {
      label: "Onboarding profile complete",
      detail: "Risk limits and emergency-fund confirmation recorded",
      passed: settings.onboardingComplete,
    },
    {
      label: "Ledger reconciled with Wealthsimple",
      detail: settings.ledgerReconciledAt
        ? `Recorded ${dateTime(settings.ledgerReconciledAt)}`
        : "No reconciliation acknowledgement recorded",
      passed: Boolean(settings.ledgerReconciledAt),
    },
    {
      label: "Full-data provider selected",
      detail:
        settings.providerMode === "full"
          ? "Full mode selected"
          : "Trial data remains research-only",
      passed: settings.providerMode === "full",
    },
    {
      label: "Canadian quote entitlement verified",
      detail: "Provider terms and timestamp freshness checked",
      passed: settings.quoteEntitlementVerified,
    },
    {
      label: `${paper.metrics.minimumCalendarDays} calendar days`,
      detail: `${calendarDays} completed since the recorded trial start`,
      passed: calendarDays >= paper.metrics.minimumCalendarDays,
    },
    {
      label: `${paper.metrics.minimumMarketSessions} market sessions`,
      detail: `${marketSessions} unique Calgary market dates with a successful run`,
      passed: marketSessions >= paper.metrics.minimumMarketSessions,
    },
    {
      label: "At least 95% scheduled-run reliability",
      detail:
        trialRuns.length > 0
          ? `${successfulRuns.length} of ${trialRuns.length} recorded runs completed cleanly`
          : "No trial runs recorded",
      passed: trialRuns.length > 0 && reliability >= 0.95,
    },
    {
      label: "No unresolved data-quality failures",
      detail:
        unresolvedFailures === 0 && trialRuns.length > 0
          ? "No failures in the recorded trial history"
          : `${unresolvedFailures} run${unresolvedFailures === 1 ? "" : "s"} need review`,
      passed: unresolvedFailures === 0 && trialRuns.length > 0,
    },
    {
      label: "Research-label acknowledgement",
      detail: "Manual review and manual Wealthsimple orders remain required",
      passed: settings.liveLabelsAcknowledged,
    },
  ];
  const allGatesPass = gates.every((gate) => gate.passed);

  return (
    <div className="page-stack">
      <Notice
        title={
          allGatesPass
            ? "Recorded paper-trial gates pass"
            : "Live-data labels remain locked"
        }
        tone={allGatesPass ? "quiet" : "warning"}
        icon={allGatesPass ? "check" : "shield"}
      >
        <p>
          {allGatesPass
            ? "Passing these recorded checks allows cautious live-data research labels only. It does not enable automatic trading or promise profitability."
            : "Continue the no-money trial and resolve every incomplete gate. Trial research can still be inspected without acting on it."}
        </p>
      </Notice>

      <section className="metric-grid">
        <Metric
          label="Calendar days"
          value={`${calendarDays} / ${paper.metrics.minimumCalendarDays}`}
          detail={`${paper.metrics.calendarDays} days represented by queued decision history`}
          icon="calendar"
          tone={
            calendarDays >= paper.metrics.minimumCalendarDays
              ? "good"
              : "watch"
          }
        />
        <Metric
          label="Market sessions"
          value={`${marketSessions} / ${paper.metrics.minimumMarketSessions}`}
          detail="Unique dates with a clean completed research run"
          icon="clock"
          tone={
            marketSessions >= paper.metrics.minimumMarketSessions
              ? "good"
              : "watch"
          }
        />
        <Metric
          label="Run reliability"
          value={trialRuns.length > 0 ? percent(reliability * 100) : "—"}
          detail={`${successfulRuns.length} clean · ${unresolvedFailures} need review`}
          icon="shield"
          tone={reliability >= 0.95 ? "good" : "watch"}
        />
        <Metric
          label="Paper decisions"
          value={paper.metrics.totalDecisions.toLocaleString("en-CA")}
          detail={`${paper.metrics.filledDecisions} filled later · ${paper.metrics.queuedFills} awaiting a later quote`}
          icon="paper"
        />
      </section>

      <section className="metric-grid">
        <Metric
          label="After-fee CAD return"
          value={percent(paper.metrics.afterFeeReturnPct, 2)}
          detail={`${money(paper.metrics.afterFeeProfitCad)} across ${paper.metrics.markedDecisions} marked decisions`}
          icon="wallet"
          tone={
            paper.metrics.afterFeeReturnPct === null
              ? "watch"
              : paper.metrics.afterFeeReturnPct >= 0
                ? "good"
                : "watch"
          }
        />
        <Metric
          label="XGRO comparison"
          value={percent(paper.metrics.benchmarkReturnPct, 2)}
          detail={`Excess return ${percent(paper.metrics.excessReturnPct, 2)} for matched windows`}
          icon="research"
        />
        <Metric
          label="Maximum drawdown"
          value={percent(paper.metrics.maxDrawdownPct, 2)}
          detail="Peak-to-trough change across recorded later marks"
          icon="reports"
          tone={
            paper.metrics.maxDrawdownPct !== null &&
            paper.metrics.maxDrawdownPct >= -10
              ? "good"
              : "watch"
          }
        />
        <Metric
          label="Turnover & FX costs"
          value={money(paper.metrics.turnoverCad)}
          detail={`${money(paper.metrics.estimatedFxCostsCad)} estimated FX costs · ${money(paper.metrics.capitalTrackedCad)} tracked capital`}
          icon="portfolio"
        />
      </section>

      <div className="dashboard-primary-grid">
        <Card>
          <CardHeader
            title="Readiness gates"
            description="Every gate must pass; a strong score cannot override one"
            action={
              <Badge tone={allGatesPass ? "good" : "watch"}>
                {gates.filter((gate) => gate.passed).length} / {gates.length}
              </Badge>
            }
          />
          <div className="checklist">
            {gates.map((gate) => (
              <div className="checklist-row" key={gate.label}>
                <span
                  className={
                    gate.passed ? "check-circle complete" : "check-circle"
                  }
                >
                  {gate.passed ? (
                    <Icon name="check" width={13} height={13} />
                  ) : (
                    <Icon name="clock" width={13} height={13} />
                  )}
                </span>
                <span>
                  <strong>{gate.label}</strong>
                  <small>{gate.detail}</small>
                </span>
              </div>
            ))}
          </div>
          <Link className="button button-quiet button-block" href="/settings">
            Review readiness settings
          </Link>
        </Card>

        <Card>
          <CardHeader
            title="Methodology"
            description={`Benchmark reference: ${paper.metrics.benchmarkSymbol}`}
          />
          <Notice title="No look-ahead fill" tone="quiet" icon="shield">
            <p>{paper.metrics.methodology}</p>
          </Notice>
          <ol className="method-list">
            <li>
              <strong>Decision timestamp</strong>
              <span>
                Freeze the action, evidence, source timestamps, and known price
                when the report is created.
              </span>
            </li>
            <li>
              <strong>Later hypothetical fill</strong>
              <span>
                Use only the first provider observation after the decision—not a
                price that was unknowable at decision time.
              </span>
            </li>
            <li>
              <strong>Realistic accounting</strong>
              <span>
                Preserve quantity, currency, trade-time FX, and estimated CAD
                fees. Paper activity never changes the real ledger.
              </span>
            </li>
            <li>
              <strong>Gate before interpretation</strong>
              <span>
                Review missing fills, failed runs, stale data, and benchmark
                coverage before comparing outcomes.
              </span>
            </li>
          </ol>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Decision ledger"
          description="Hypothetical observations only—no Wealthsimple orders"
          action={
            <Badge tone={paper.trades.length ? "info" : "neutral"}>
              {paper.trades.length} record{paper.trades.length === 1 ? "" : "s"}
            </Badge>
          }
        />
        {paper.trades.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Security</th>
                  <th>Research label</th>
                  <th className="number">Decision price</th>
                  <th>Later fill observation</th>
                  <th className="number">Current outcome</th>
                  <th className="number">XGRO window</th>
                  <th className="number">Fees (CAD)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paper.trades.map((trade) => {
                  const currency =
                    trade.decisionCurrency === "USD" ? "USD" : "CAD";
                  return (
                    <tr key={trade.id}>
                      <td>
                        <strong>{dateTime(trade.decisionTime)}</strong>
                        <span className="cell-subtitle">
                          {trade.recommendationId
                            ? "Linked recommendation"
                            : "Recommendation unavailable"}
                        </span>
                      </td>
                      <td>
                        <strong>{trade.canonicalSymbol}</strong>
                        <span className="cell-subtitle">
                          {trade.quantity.toLocaleString("en-CA", {
                            maximumFractionDigits: 6,
                          })}{" "}
                          hypothetical shares · {currency}
                        </span>
                      </td>
                      <td>
                        <Badge tone={actionTone(trade.action)}>
                          {humanAction(trade.action)}
                        </Badge>
                      </td>
                      <td className="number">
                        {money(trade.decisionPrice, currency)}
                        <span className="cell-subtitle">
                          FX {trade.fxRateToCad.toFixed(4)} CAD
                        </span>
                      </td>
                      <td>
                        {trade.hypotheticalFillPrice === null ? (
                          <span>Waiting for a later provider price</span>
                        ) : (
                          <>
                            <strong>
                              {money(trade.hypotheticalFillPrice, currency)}
                            </strong>
                            <span className="cell-subtitle">
                              {dateTime(trade.hypotheticalFillTime)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="number">
                        <strong
                          className={
                            (trade.outcome?.afterFeeProfitCad ?? 0) >= 0
                              ? "value-positive"
                              : "value-negative"
                          }
                        >
                          {money(trade.outcome?.afterFeeProfitCad)}
                        </strong>
                        <span className="cell-subtitle">
                          {percent(trade.outcome?.afterFeeReturnPct, 2)}
                          {trade.outcome?.markedAt
                            ? ` · ${dateTime(trade.outcome.markedAt)}`
                            : " · awaiting a later mark"}
                        </span>
                      </td>
                      <td className="number">
                        {percent(trade.outcome?.benchmarkReturnPct, 2)}
                        <span className="cell-subtitle">
                          excess {percent(trade.outcome?.excessReturnPct, 2)}
                        </span>
                      </td>
                      <td className="number">{money(trade.feesCad)}</td>
                      <td>
                        <Badge
                          tone={
                            trade.status === "filled"
                              ? "good"
                              : trade.status === "queued"
                                ? "watch"
                                : "neutral"
                          }
                        >
                          {trade.status}
                        </Badge>
                        <span className="cell-subtitle">
                          benchmark {trade.benchmarkSymbol}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="paper"
            title="No paper decisions yet"
            description="Start the paper trial in Settings, run research, and keep all activity hypothetical while the safety gates are evaluated."
            action={
              <Link className="button button-secondary" href="/settings">
                Start paper trial
              </Link>
            }
          />
        )}
      </Card>

      <Notice title="Paper performance is not investable performance" tone="warning">
        <p>
          It can omit slippage, spread, tax effects, liquidity, partial fills,
          behavioural mistakes, and future market conditions. Do not enable
          live-data labels merely because a small sample looks profitable.
        </p>
      </Notice>
    </div>
  );
}

function daysSince(value: string): number {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
}

function calgaryDateKey(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return "invalid";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function humanAction(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
