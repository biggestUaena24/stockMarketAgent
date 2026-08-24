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
  dateTime,
  money,
  percent,
  useApi,
} from "@/app/lib/client";
import type { ReportsPayload } from "@/app/lib/view-types";
import type {
  EvidenceView,
  RecommendationView,
  ResearchRunView,
} from "@/lib/reports";

export function ReportsScreen() {
  const { data, error, loading, reload } = useApi<ReportsPayload>(
    "/api/reports?limit=50",
  );
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<
    string | null
  >(null);

  const reports = data?.reports ?? [];
  const selectedReport =
    reports.find((report) => report.id === selectedReportId) ??
    reports[0] ??
    null;
  const selectedRecommendation =
    selectedReport?.recommendations.find(
      (recommendation) => recommendation.id === selectedRecommendationId,
    ) ??
    selectedReport?.recommendations[0] ??
    null;

  function selectReport(report: ResearchRunView) {
    setSelectedReportId(report.id);
    setSelectedRecommendationId(report.recommendations[0]?.id ?? null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Saved, timestamped decision support"
        title="Report history"
        description="Review every Calgary-time research run, the action labels it produced, and the source evidence behind each result. Reports never place an order."
        action={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void reload()}
            disabled={loading}
          >
            <Icon name="refresh" width={17} height={17} />
            {loading ? "Refreshing…" : "Refresh history"}
          </button>
        }
      />

      {loading && !data ? (
        <LoadingBlock rows={7} />
      ) : error || !data ? (
        <ErrorState
          message={error ?? "Report history is unavailable."}
          onRetry={reload}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          icon="reports"
          title="No reports have been saved"
          description="Run research from the overview after configuring your investing profile and market-data provider."
          action={
            <Link className="button button-primary" href="/">
              Open overview
            </Link>
          }
        />
      ) : (
        <div className="page-stack">
          <div className="report-layout">
            <Card>
              <CardHeader
                title="Saved runs"
                description={`${reports.length} most recent report${reports.length === 1 ? "" : "s"}`}
              />
              <div className="report-list">
                {reports.map((report) => {
                  const selected = report.id === selectedReport?.id;
                  return (
                    <button
                      className={`report-list-item ${
                        selected ? "active" : ""
                      }`}
                      type="button"
                      key={report.id}
                      onClick={() => selectReport(report)}
                      aria-pressed={selected}
                    >
                      <span className="batch-icon">
                        <Icon
                          name={report.slot === "morning" ? "spark" : "document"}
                          width={18}
                          height={18}
                        />
                      </span>
                      <span>
                        <strong>{runTitle(report)}</strong>
                        <small>{dateTime(report.actualTime)}</small>
                        <span className="micro-meta">
                          <span>
                            {report.recommendations.length} result
                            {report.recommendations.length === 1 ? "" : "s"}
                          </span>
                          <span>{report.dataFreshness} data</span>
                        </span>
                      </span>
                      <Badge tone={statusTone(report.status)}>
                        {humanize(report.status)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </Card>

            {selectedReport ? (
              <ReportOverview report={selectedReport} />
            ) : null}
          </div>

          {selectedReport ? (
            <Card>
              <CardHeader
                title="Recommendations in this report"
                description="Select a symbol to inspect the saved thesis, risks, and supporting evidence."
                action={
                  <Badge tone={freshnessTone(selectedReport.dataFreshness)}>
                    {humanize(selectedReport.dataFreshness)}
                  </Badge>
                }
              />
              {selectedReport.recommendations.length ? (
                <div className="recommendation-list">
                  {selectedReport.recommendations.map((recommendation) => {
                    const selected =
                      recommendation.id === selectedRecommendation?.id;
                    return (
                      <article
                        className={`recommendation-row ${
                          selected ? "active" : ""
                        }`}
                        key={recommendation.id}
                      >
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
                              <span className="research-only-label">
                                Research only
                              </span>
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
                            <span>{humanize(recommendation.confidence)} confidence</span>
                            <span>
                              {recommendation.evidence.length} source
                              {recommendation.evidence.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                        <button
                          className="round-link"
                          type="button"
                          onClick={() =>
                            setSelectedRecommendationId(recommendation.id)
                          }
                          aria-label={`Inspect ${recommendation.symbol} recommendation`}
                          aria-pressed={selected}
                        >
                          <Icon
                            name={selected ? "check" : "arrow"}
                            width={17}
                            height={17}
                          />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon="research"
                  title="No recommendations were produced"
                  description="Open the run diagnostics above. Missing or stale evidence intentionally fails closed."
                />
              )}
            </Card>
          ) : null}

          {selectedRecommendation ? (
            <RecommendationDetails recommendation={selectedRecommendation} />
          ) : null}
        </div>
      )}
    </>
  );
}

function ReportOverview({ report }: { report: ResearchRunView }) {
  const focus = recordString(report.summary, "focus");
  const provider =
    recordString(report.summary, "provider") ?? humanize(report.providerVersion);
  const researchedSymbols = recordStringArray(
    report.summary,
    "researchedSymbols",
  );
  const execution = recordString(report.summary, "execution");
  const notification = recordObject(report.summary, "notification");
  const notificationStatus = notification
    ? recordString(notification, "status")
    : null;
  const notificationReason = notification
    ? recordString(notification, "reason")
    : null;
  const researchDiagnostics = report.errors.filter(
    (item) => !item.startsWith("Email delivery:"),
  );

  return (
    <Card>
      <CardHeader
        title={runTitle(report)}
        description={`Started ${dateTime(report.actualTime)}`}
        action={
          <Badge tone={statusTone(report.status)}>
            {humanize(report.status)}
          </Badge>
        }
      />

      {focus ? <p>{focus}</p> : null}

      <div className="setup-checks">
        <div className="checklist-row">
          <span className="batch-icon">
            <Icon name="clock" width={17} height={17} />
          </span>
          <div>
            <strong>Scheduled</strong>
            <span>{dateTime(report.scheduledTime)}</span>
          </div>
        </div>
        <div className="checklist-row">
          <span className="batch-icon">
            <Icon name="research" width={17} height={17} />
          </span>
          <div>
            <strong>Research provider</strong>
            <span>{provider}</span>
          </div>
        </div>
        <div className="checklist-row">
          <span className="batch-icon">
            <Icon name="document" width={17} height={17} />
          </span>
          <div>
            <strong>Evidence state</strong>
            <span>
              {humanize(report.dataFreshness)} · model{" "}
              {humanize(report.modelVersion)}
            </span>
          </div>
        </div>
      </div>

      {researchedSymbols.length ? (
        <div className="detail-block">
          <strong>Symbols covered</strong>
          <div className="micro-meta">
            {researchedSymbols.map((symbol) => (
              <span key={symbol}>{symbol}</span>
            ))}
          </div>
        </div>
      ) : null}

      {execution ? (
        <div className="timezone-note">
          <Icon name="shield" width={17} height={17} />
          {execution}
        </div>
      ) : null}

      {notificationStatus ? (
        <Notice
          title={notificationTitle(notificationStatus)}
          tone={notificationStatus === "failed" ? "warning" : "quiet"}
          icon={notificationStatus === "failed" ? "warning" : "clock"}
        >
          <p>
            {notificationReason ??
              "Notification status was recorded without additional detail."}{" "}
            Email is optional and does not change research data quality or
            scheduled-run reliability.
          </p>
        </Notice>
      ) : null}

      {researchDiagnostics.length ? (
        <Notice
          title={`${researchDiagnostics.length} research diagnostic${
            researchDiagnostics.length === 1 ? "" : "s"
          }`}
          tone="warning"
          icon="warning"
        >
          <ul className="compact-list">
            {researchDiagnostics.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice title="Research completed without saved data diagnostics" tone="quiet" icon="check">
          <p>
            Review source timestamps below before relying on any result.
          </p>
        </Notice>
      )}
    </Card>
  );
}

export function RecommendationDetails({
  recommendation,
  researchLink = true,
}: {
  recommendation: RecommendationView;
  researchLink?: boolean;
}) {
  const currency =
    recommendation.valuationCurrency === "USD" ? "USD" : "CAD";
  const valuation =
    recommendation.valuationLow === null ||
    recommendation.valuationHigh === null
      ? "Not available"
      : `${money(recommendation.valuationLow, currency)}–${money(
          recommendation.valuationHigh,
          currency,
        )}`;

  return (
    <div className="page-stack">
      <section
        className="research-hero"
        aria-label={`${recommendation.symbol} research summary`}
      >
        <div>
          <p className="eyebrow">Latest saved decision support</p>
          <h2>
            {recommendation.symbol} · {recommendation.action}
          </h2>
          <p>
            {humanize(recommendation.confidence)} confidence ·{" "}
            {recommendation.evidence.length} linked source
            {recommendation.evidence.length === 1 ? "" : "s"}
          </p>
        </div>
        <strong className="score-number">
          {recommendation.score === null
            ? "—"
            : Math.round(recommendation.score)}
        </strong>
      </section>

      <Card>
        <CardHeader
          title={`${recommendation.symbol} decision record`}
          description="The score is deterministic; the narrative organizes saved evidence and does not execute a trade."
          action={
            <div className="recommendation-title">
              <Badge tone={actionTone(recommendation.action)}>
                {recommendation.action}
              </Badge>
              {researchLink ? (
                <Link
                  className="text-button"
                  href={`/research?symbol=${encodeURIComponent(
                    recommendation.symbol,
                  )}`}
                >
                  Open symbol view
                  <Icon name="arrow" width={14} height={14} />
                </Link>
              ) : null}
            </div>
          }
        />

        {recommendation.researchOnly ? (
          <Notice title="Research-only label" tone="info" icon="shield">
            <p>
              Treat this as a prompt for further review. No order was created,
              and Wealthsimple remains the only place to trade.
            </p>
          </Notice>
        ) : null}

        <section className="metric-grid metric-grid-three">
          <Metric
            label="Research score"
            value={
              recommendation.score === null
                ? "Unavailable"
                : `${Math.round(recommendation.score)} / 100`
            }
            detail={`${humanize(recommendation.confidence)} confidence`}
            icon="research"
            tone={
              recommendation.score !== null && recommendation.score >= 60
                ? "good"
                : "watch"
            }
          />
          <Metric
            label="Valuation range"
            value={valuation}
            detail={
              recommendation.valuationLow === null
                ? "No defensible range was saved."
                : `${currency} · range, not a price target`
            }
            icon="portfolio"
          />
          <Metric
            label="Allocation cap"
            value={percent(recommendation.allocationCapPct)}
            detail="Maximum portfolio-fit guardrail, not an instruction."
            icon="shield"
            tone="watch"
          />
        </section>

        <div className="detail-grid">
          <div className="detail-block">
            <p className="eyebrow">Saved thesis</p>
            <p>{recommendation.thesis}</p>
          </div>
          <div className="detail-block">
            <p className="eyebrow">Portfolio impact</p>
            <p>{recommendation.portfolioImpact}</p>
          </div>
        </div>

        <div className="micro-meta">
          <span>Data as of {dateTime(recommendation.dataAsOf)}</span>
          <span>
            {recommendation.quoteDelayMinutes === null
              ? "Quote delay not verified"
              : `${recommendation.quoteDelayMinutes}-minute quote delay`}
          </span>
          <span>
            {recommendation.evidence.length} linked source
            {recommendation.evidence.length === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      <div className="detail-grid">
        <DetailListCard
          title="Potential catalysts"
          description="Evidence that could support the thesis"
          icon="spark"
          items={recommendation.catalysts}
          empty="No catalyst was saved."
        />
        <DetailListCard
          title="Risks and contrary evidence"
          description="Reasons to slow down or reject the thesis"
          icon="warning"
          items={[...recommendation.risks, ...recommendation.contraryEvidence]}
          empty="No contrary evidence was saved; that is not proof of low risk."
        />
      </div>

      <Card>
        <CardHeader
          title="Invalidation conditions"
          description="Reassess the thesis if any of these conditions occur."
        />
        {recommendation.invalidationConditions.length ? (
          <ul className="checklist compact-list">
            {recommendation.invalidationConditions.map((item, index) => (
              <li className="checklist-row" key={`${index}-${item}`}>
                <span className="batch-icon">
                  <Icon name="warning" width={16} height={16} />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No explicit invalidation condition was saved.</p>
        )}
      </Card>

      <EvidenceList evidence={recommendation.evidence} />
    </div>
  );
}

function DetailListCard({
  title,
  description,
  icon,
  items,
  empty,
}: {
  title: string;
  description: string;
  icon: "spark" | "warning";
  items: string[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length ? (
        <ul className="checklist compact-list">
          {items.map((item, index) => (
            <li className="checklist-row" key={`${index}-${item}`}>
              <span className="batch-icon">
                <Icon name={icon} width={16} height={16} />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </Card>
  );
}

function EvidenceList({ evidence }: { evidence: EvidenceView[] }) {
  return (
    <Card>
      <CardHeader
        title="Source evidence"
        description="Open the original source and check its timestamp before making a decision."
        action={
          <Badge tone={evidence.length ? "info" : "neutral"}>
            {evidence.length} source{evidence.length === 1 ? "" : "s"}
          </Badge>
        }
      />
      {evidence.length ? (
        <div className="evidence-list">
          {evidence.map((item) => {
            const source = safeHttpUrl(item.sourceUrl);
            return (
              <article className="evidence-item" key={item.id}>
                <span className="batch-icon">
                  <Icon name="external" width={17} height={17} />
                </span>
                <div>
                  <div className="recommendation-title">
                    {source ? (
                      <a
                        className="inline-link"
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {humanize(item.category)}
                        <Icon name="external" width={13} height={13} />
                      </a>
                    ) : (
                      <strong>{humanize(item.category)}</strong>
                    )}
                    <Badge tone={freshnessTone(item.freshness)}>
                      {humanize(item.freshness)}
                    </Badge>
                  </div>
                  {item.facts.length ? (
                    <ul className="compact-list">
                      {item.facts.map((fact, index) => (
                        <li key={`${index}-${fact}`}>{fact}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No extracted fact was saved for this source.</p>
                  )}
                  <div className="micro-meta">
                    <span>{humanize(item.provider)}</span>
                    <span>
                      {dateTime(item.publicationTime ?? item.marketDataTime)}
                    </span>
                    {item.sentiment === null ? null : (
                      <span>Sentiment {item.sentiment.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="research"
          title="No source evidence was linked"
          description="Treat the recommendation as insufficient data and do not act on it."
        />
      )}
    </Card>
  );
}

function runTitle(report: ResearchRunView): string {
  return report.slot === "morning" ? "Morning brief" : "Evening review";
}

function humanize(value: string): string {
  return value
    .replace(/[_:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(
  status: string,
): "neutral" | "good" | "watch" | "risk" | "info" {
  const value = status.toLowerCase();
  if (value === "complete") return "good";
  if (value === "degraded") return "watch";
  if (value === "failed") return "risk";
  if (value === "running") return "info";
  return "neutral";
}

function freshnessTone(
  freshness: string,
): "neutral" | "good" | "watch" | "risk" | "info" {
  const value = freshness.toLowerCase();
  if (value === "verified" || value === "fresh") return "good";
  if (value === "limited" || value.includes("stale")) return "watch";
  if (value.includes("expired")) return "risk";
  return "neutral";
}

function recordString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && Boolean(item),
      )
    : [];
}

function recordObject(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function notificationTitle(status: string): string {
  switch (status) {
    case "sent":
      return "Email notification sent";
    case "skipped":
      return "Email notification skipped (optional)";
    case "failed":
      return "Email notification failed";
    case "not-requested":
      return "Email notification not requested for this manual run";
    default:
      return "Email notification pending";
  }
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
