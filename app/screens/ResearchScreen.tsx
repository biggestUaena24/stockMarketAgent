"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/app/components/icons";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import { apiRequest, dateTime, useApi } from "@/app/lib/client";
import type { ResearchPayload } from "@/app/lib/view-types";
import { RecommendationDetails } from "@/app/screens/ReportsScreen";

type RunPayload = {
  run: {
    runId: string;
    status: string;
    researchedSymbols: string[];
    rejectedSymbols: string[];
    recommendationCount: number;
    errors: string[];
  };
};

type RunNotice = {
  title: string;
  detail: string;
  tone: "quiet" | "warning";
};

export function ResearchScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const symbol = normalizeSymbol(searchParams.get("symbol") ?? "");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextSymbol = normalizeSymbol(String(form.get("symbol") ?? ""));
    if (!nextSymbol) return;
    router.push(`/research?symbol=${encodeURIComponent(nextSymbol)}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="One symbol, every saved source"
        title="Company research"
        description="Open the latest saved decision record for a ticker. Scores, confidence, contrary evidence, and source timestamps stay visible together."
      />

      <div className="research-layout">
        <Card>
          <CardHeader
            title="Find a saved symbol"
            description="Use the canonical ticker from your portfolio or watchlist."
          />
          <form className="form-grid compact-form" onSubmit={search}>
            <label className="field">
              <span>Ticker symbol</span>
              <input
                key={symbol}
                name="symbol"
                defaultValue={symbol}
                placeholder="e.g. VFV, SHOP, or MSFT"
                maxLength={20}
                pattern="[A-Za-z0-9.-]+"
                title="Use letters, numbers, periods, or hyphens."
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </label>
            <div className="form-actions">
              <button className="button button-primary" type="submit">
                <Icon name="research" width={17} height={17} />
                Open latest research
              </button>
            </div>
          </form>
        </Card>

        {!symbol ? (
          <Card>
            <EmptyState
              icon="research"
              title="Choose a ticker to begin"
              description="This page reads saved research only. Add symbols and provider settings before running a new portfolio brief."
              action={
                <Link className="button button-secondary" href="/settings">
                  Review research settings
                </Link>
              }
            />
          </Card>
        ) : (
          <ResearchResult key={symbol} symbol={symbol} />
        )}
      </div>
    </>
  );
}

function ResearchResult({ symbol }: { symbol: string }) {
  const { data, error, loading, reload } = useApi<ResearchPayload>(
    `/api/research?symbol=${encodeURIComponent(symbol)}`,
  );
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<RunNotice | null>(null);

  async function rerunResearch() {
    setRunning(true);
    setNotice(null);
    try {
      const payload = await apiRequest<RunPayload>("/api/runs", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const covered = payload.run.researchedSymbols.some(
        (item) => normalizeSymbol(item) === symbol,
      );
      const completed = payload.run.status === "complete";
      setNotice(
        covered
          ? {
              title: completed
                ? `${symbol} research was refreshed`
                : `${symbol} was reviewed with limited data`,
              detail:
                payload.run.errors[0] ??
                "Open the source list and timestamps before making any decision.",
              tone: completed ? "quiet" : "warning",
            }
          : {
              title: `${symbol} was not included in this run`,
              detail:
                payload.run.rejectedSymbols.includes(symbol)
                  ? "The current provider or safety universe rejected this symbol. Review the run diagnostics and settings."
                  : "Manual runs cover the configured portfolio and watchlist. Add this ticker in Settings before trying again.",
              tone: "warning",
            },
      );
      await reload();
    } catch (caught) {
      setNotice({
        title: "Research run failed",
        detail:
          caught instanceof Error ? caught.message : "The request failed.",
        tone: "warning",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-stack">
      {notice ? (
        <Notice
          title={notice.title}
          tone={notice.tone}
          icon={notice.tone === "warning" ? "warning" : "check"}
        >
          <p>{notice.detail}</p>
          <p>No order was created or sent to Wealthsimple.</p>
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title={`${symbol} saved research`}
          description={
            data?.research.dataAsOf
              ? `Latest evidence ${dateTime(data.research.dataAsOf)}`
              : "Run the configured portfolio and watchlist research workflow."
          }
          action={
            <button
              className="button button-secondary"
              type="button"
              onClick={rerunResearch}
              disabled={running}
            >
              <Icon name="refresh" width={17} height={17} />
              {running ? "Researching…" : "Run research again"}
            </button>
          }
        />
        <div className="timezone-note">
          <Icon name="shield" width={17} height={17} />
          Manual reruns use the same deterministic gates as scheduled reports
          and never submit a trade.
        </div>
      </Card>

      {loading && !data ? (
        <LoadingBlock rows={7} />
      ) : error || !data ? (
        <div className="page-stack">
          <ErrorState
            message={
              error ??
              `No saved research is available for ${symbol}.`
            }
            onRetry={reload}
          />
          <Notice
            title="A rerun may not include this ticker"
            tone="info"
            icon="research"
          >
            <p>
              Research runs cover your configured holdings and watchlist. Add{" "}
              {symbol} in Settings if it is not already included.
            </p>
            <Link className="inline-link" href="/settings">
              Open settings
              <Icon name="arrow" width={14} height={14} />
            </Link>
          </Notice>
        </div>
      ) : (
        <>
          <div className="micro-meta">
            <Badge tone={data.research.researchOnly ? "watch" : "info"}>
              {data.research.researchOnly
                ? "Research only"
                : "Decision support"}
            </Badge>
            <span>{data.research.evidence.length} linked sources</span>
            <span>
              {data.research.quoteDelayMinutes === null
                ? "Quote delay unverified"
                : `${data.research.quoteDelayMinutes}-minute quote delay`}
            </span>
          </div>
          <RecommendationDetails
            recommendation={data.research}
            researchLink={false}
          />
        </>
      )}
    </div>
  );
}

function normalizeSymbol(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9.\-]/g, "")
    .slice(0, 20);
}
