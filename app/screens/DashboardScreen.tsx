"use client";

import Link from "next/link";
import { useState } from "react";
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
  apiRequest,
  dateTime,
  marketDataTime,
  money,
  percent,
  useApi,
} from "@/app/lib/client";
import type { DashboardPayload } from "@/app/lib/view-types";
import { requiredResearchSetupReady } from "@/lib/research/setup-readiness";

export function DashboardScreen() {
  const { data, error, loading, reload } =
    useApi<DashboardPayload>("/api/dashboard");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  async function runResearch() {
    setRunning(true);
    setRunMessage(null);
    try {
      const payload = await apiRequest<{
        run: { status: string; recommendationCount: number; errors: string[] };
      }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const trialCacheOnly = data?.settings.providerMode === "trial";
      setRunMessage(
        payload.run.status === "complete"
          ? trialCacheOnly
            ? `Saved research reviewed with ${payload.run.recommendationCount} results.`
            : `Research finished with ${payload.run.recommendationCount} results.`
          : trialCacheOnly
            ? "The saved-data review found missing or stale evidence. Scheduled checks perform the trial refreshes."
            : "The run finished with limited data. Open the report for details.",
      );
      await reload();
    } catch (caught) {
      setRunMessage(
        caught instanceof Error ? caught.message : "Research run failed.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Calgary-time portfolio desk"
        title="A clear view before any decision."
        description="Your ledger, research evidence, and safety gates in one quiet workspace. Wealthsimple remains the place where you manually trade."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={runResearch}
            disabled={running}
          >
            <Icon name={running ? "refresh" : "spark"} width={17} height={17} />
            {running
              ? data?.settings.providerMode === "trial"
                ? "Reviewing…"
                : "Researching…"
              : data?.settings.providerMode === "trial"
                ? "Review saved data"
                : "Run research now"}
          </button>
        }
      />

      {runMessage ? (
        <Notice
          title={runMessage}
          tone={runMessage.includes("failed") ? "warning" : "quiet"}
          icon={runMessage.includes("failed") ? "warning" : "check"}
        >
          <p>No order was created or sent to Wealthsimple.</p>
        </Notice>
      ) : null}

      {loading ? (
        <div className="dashboard-loading">
          <LoadingBlock rows={5} />
        </div>
      ) : error || !data ? (
        <ErrorState message={error ?? "Dashboard data is unavailable."} onRetry={reload} />
      ) : (
        <DashboardContent data={data} />
      )}
    </>
  );
}

function DashboardContent({ data }: { data: DashboardPayload }) {
  const latest = data.reports[0];
  const setupReady = requiredResearchSetupReady({
    onboardingComplete: data.settings.onboardingComplete,
    providerMode: data.settings.providerMode,
    alphaVantageConfigured: data.configuration.alphaVantage,
    fmpConfigured: data.configuration.fmp,
    schedulerSecretConfigured: data.configuration.schedulerSecret,
  });
  const lastResearch =
    latest?.completedAt ?? latest?.actualTime ?? null;

  return (
    <div className="page-stack">
      {!data.settings.onboardingComplete ? (
        <Notice title="Finish your investing profile" tone="warning" icon="warning">
          <p>
            Confirm your time horizon, loss tolerance, emergency fund, cash, and
            TFSA room estimate before using research results.
          </p>
          <Link className="inline-link" href="/settings">
            Complete setup <Icon name="arrow" width={14} height={14} />
          </Link>
        </Notice>
      ) : null}

      {data.settings.providerMode === "trial" ? (
        <Notice title="Trial market data refreshes on schedule" tone="quiet" icon="clock">
          <p>
            The 7:30 a.m. and 5:30 p.m. Calgary checks refresh Alpha Vantage
            data. Manual reviews use the saved cache and do not spend the
            scheduled request allowance.
          </p>
        </Notice>
      ) : null}

      <section className="metric-grid">
        <Metric
          label="Tracked total"
          value={money(data.portfolio.totalTrackedCad)}
          detail={data.portfolio.valuationLabel}
          icon="wallet"
        />
        <Metric
          label="Available cash"
          value={money(data.portfolio.availableCashCad)}
          detail="Owner-maintained value; reconcile with Wealthsimple."
          icon="portfolio"
        />
        <Metric
          label="TFSA net flows"
          value={money(data.portfolio.tfsa.netCashFlowCad)}
          detail={`${money(data.portfolio.tfsa.contributionsCad)} contributed · ${money(data.portfolio.tfsa.withdrawalsCad)} withdrawn`}
          icon="document"
        />
        <Metric
          label="Research status"
          value={
            latest
              ? latest.status === "complete"
                ? "Up to date"
                : "Needs data"
              : "Not run yet"
          }
          detail={
            lastResearch
              ? `Last run ${dateTime(lastResearch)}`
              : "Run after market-data keys are configured."
          }
          icon="clock"
          tone={latest?.status === "complete" ? "good" : "watch"}
        />
      </section>

      <div className="dashboard-primary-grid">
        <Card className="research-overview-card">
          <CardHeader
            title="Latest research"
            description={
              latest
                ? `${latest.slot === "morning" ? "Morning brief" : "Evening review"} · ${dateTime(latest.actualTime)}`
                : "Evidence-backed watch and holding reviews"
            }
            action={
              <Link className="text-button" href="/reports">
                Report history <Icon name="arrow" width={14} height={14} />
              </Link>
            }
          />
          {latest?.recommendations.length ? (
            <div className="recommendation-list">
              {latest.recommendations.slice(0, 4).map((recommendation) => (
                <article className="recommendation-row" key={recommendation.id}>
                  <div className="symbol-token">
                    {recommendation.symbol.slice(0, 4)}
                  </div>
                  <div className="recommendation-copy">
                    <div className="recommendation-title">
                      <strong>{recommendation.symbol}</strong>
                      <Badge tone={actionTone(recommendation.action)}>
                        {recommendation.action}
                      </Badge>
                      {recommendation.researchOnly ? (
                        <span className="research-only-label">Research only</span>
                      ) : null}
                    </div>
                    <p>{recommendation.thesis}</p>
                    <div className="micro-meta">
                      <span>
                        Score{" "}
                        {recommendation.score === null
                          ? "not available"
                          : Math.round(recommendation.score)}
                      </span>
                      <span>{recommendation.confidence} confidence</span>
                      <span>{recommendation.evidence.length} sources</span>
                    </div>
                  </div>
                  <Link
                    className="round-link"
                    href={`/research?symbol=${encodeURIComponent(
                      recommendation.symbol,
                    )}`}
                    aria-label={`Open research for ${recommendation.symbol}`}
                  >
                    <Icon name="arrow" width={17} height={17} />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="research"
              title="No completed research yet"
              description="Configure the trial provider, then run a brief. Missing evidence will fail closed as “Insufficient data.”"
              action={
                <Link className="button button-secondary" href="/settings">
                  Review data setup
                </Link>
              }
            />
          )}
        </Card>

        <Card className="next-run-card">
          <CardHeader
            title="Next checks"
            description="Timezone-aware weekday schedule"
          />
          <div className="run-timeline">
            {data.schedule.nextRuns.map((run, index) => (
              <div className="run-timeline-item" key={`${run.slot}-${run.at}`}>
                <span className="timeline-marker">
                  {index === 0 ? <span /> : null}
                </span>
                <div>
                  <strong>{run.label}</strong>
                  <span>{dateTime(run.at)}</span>
                  <small>
                    {run.slot === "morning"
                      ? "Prior close, overnight evidence, opening-volatility reminder"
                      : "Completed-session review and next-session preparation"}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <div className="timezone-note">
            <Icon name="calendar" width={17} height={17} />
            America/Edmonton adjusts automatically for daylight saving time.
          </div>
        </Card>
      </div>

      <div className="dashboard-secondary-grid">
        <Card>
          <CardHeader
            title="Portfolio snapshot"
            description={data.portfolio.valuationLabel}
            action={
              <Link className="text-button" href="/portfolio">
                Open ledger <Icon name="arrow" width={14} height={14} />
              </Link>
            }
          />
          {data.portfolio.holdings.length ? (
            <div className="holding-list">
              {data.portfolio.holdings.slice(0, 5).map((holding) => (
                <div className="holding-row" key={holding.key}>
                  <div>
                    <strong>{holding.symbol}</strong>
                    <span>
                      {holding.exchange} · {holding.quantity.toLocaleString("en-CA", {
                        maximumFractionDigits: 6,
                      })}{" "}
                      shares
                    </span>
                    <span>
                      {holding.markSourceUrl ? (
                        <a
                          className="inline-link"
                          href={holding.markSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {holding.markSourceLabel}
                        </a>
                      ) : (
                        holding.markSourceLabel
                      )}{" "}
                      ·{" "}
                      {marketDataTime(
                        holding.markedPriceAt,
                        holding.markedPriceTimePrecision,
                      )}{" "}
                      ·{" "}
                      {holding.markFreshness === "fresh"
                        ? "fresh"
                        : holding.markFreshness === "stale"
                          ? "stale"
                          : "not a market quote"}
                    </span>
                  </div>
                  <div className="allocation-track" aria-label={`${holding.allocationPct}% allocation`}>
                    <span style={{ width: `${Math.min(100, holding.allocationPct)}%` }} />
                  </div>
                  <div className="holding-value">
                    <strong>{money(holding.estimatedLiquidationValueCad)}</strong>
                    <span
                      className={
                        holding.unrealizedGainCad >= 0
                          ? "value-positive"
                          : "value-negative"
                      }
                    >
                      {percent(holding.unrealizedReturnPctCad)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="portfolio"
              title="Your ledger is empty"
              description="Enter a holding manually or preview a Wealthsimple CSV import."
              action={
                <Link className="button button-secondary" href="/portfolio">
                  Add first transaction
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Readiness path"
            description="Live labels stay locked until every safeguard passes"
          />
          <div className="checklist">
            <ReadinessRow
              complete={data.settings.onboardingComplete}
              label="Investment profile completed"
            />
            <ReadinessRow
              complete={Boolean(data.settings.ledgerReconciledAt)}
              label="Ledger reconciled"
            />
            <ReadinessRow
              complete={
                data.settings.providerMode === "full" &&
                data.configuration.fmp &&
                data.settings.quoteEntitlementVerified
              }
              label="Full provider and TSX entitlement verified"
            />
            <ReadinessRow
              complete={data.settings.liveLabelsAcknowledged}
              label="Research-only acknowledgement recorded"
            />
            <ReadinessRow
              complete={false}
              label="30 calendar days / 20 market sessions completed"
            />
          </div>
          <Link className="button button-quiet button-block" href="/paper">
            View paper-trial progress
          </Link>
        </Card>
      </div>

      <SetupStrip data={data} requiredReady={setupReady} />

      <Notice title="TFSA room is an estimate, not a live CRA balance" tone="quiet">
        <p>
          The 2026 annual limit is seeded at {money(data.settings.tfsaAnnualLimitCad)}.
          Withdrawals generally return as room next calendar year; investment
          losses do not restore room, and excess contributions can face a monthly
          tax. Confirm your room with CRA records before contributing.
        </p>
      </Notice>
    </div>
  );
}

function ReadinessRow({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <div className="checklist-row">
      <span className={complete ? "check-circle complete" : "check-circle"}>
        {complete ? <Icon name="check" width={13} height={13} /> : null}
      </span>
      <span>{label}</span>
    </div>
  );
}

function SetupStrip({
  data,
  requiredReady,
}: {
  data: DashboardPayload;
  requiredReady: boolean;
}) {
  const provider: readonly [string, boolean] =
    data.settings.providerMode === "full"
      ? ["FMP market data · required", data.configuration.fmp]
      : ["Alpha Vantage market data · required", data.configuration.alphaVantage];
  const emailReady =
    data.configuration.resend && data.configuration.notificationEmail;
  const checks = [
    provider,
    ["Scheduler protection · required", data.configuration.schedulerSecret],
    [
      `OpenAI explanations · optional ${data.configuration.openai ? "on" : "off"}`,
      data.configuration.openai,
    ],
    [`Email notifications · optional ${emailReady ? "on" : "off"}`, emailReady],
  ] as const;
  return (
    <Card className="setup-strip">
      <div>
        <p className="eyebrow">Service status</p>
        <h2>
          {requiredReady
            ? "Required research setup is ready"
            : "Finish the required research setup"}
        </h2>
        <p>
          Market data, completed onboarding, and scheduler protection are
          required. OpenAI wording and email notifications are optional and do
          not block research readiness.
        </p>
      </div>
      <div className="setup-checks">
        {checks.map(([label, ready]) => (
          <span key={label} className={ready ? "ready" : ""}>
            <Icon name={ready ? "check" : "clock"} width={14} height={14} />
            {label}
          </span>
        ))}
      </div>
      <Link className="button button-secondary" href="/settings">
        Review setup
      </Link>
    </Card>
  );
}
