import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runnerSource = readFileSync("lib/research-runner.ts", "utf8");
const dashboardSource = readFileSync(
  "app/screens/DashboardScreen.tsx",
  "utf8",
);
const settingsSource = readFileSync(
  "app/screens/SettingsScreen.tsx",
  "utf8",
);
const researchSource = readFileSync(
  "app/screens/ResearchScreen.tsx",
  "utf8",
);

test("scheduled Alpha runs own the durable request budget and manual runs are cache-only", () => {
  assert.match(runnerSource, /providerFor\(settings, request\)/);
  assert.match(
    runnerSource,
    /request\.trigger === "scheduled" && apiKey[\s\S]*?new D1ProviderRequestBudget\(\{[\s\S]*?provider: "alpha-vantage"[\s\S]*?credential: apiKey[\s\S]*?dailyLimit: 24/,
  );
  assert.match(
    runnerSource,
    /cacheOnly: request\.trigger === "manual"/,
  );
  assert.match(
    runnerSource,
    /if \(settings\.providerMode === "full"\) \{[\s\S]*?new FmpFullProvider\(\{[\s\S]*?apiKey: getRuntimeEnv\("FMP_API_KEY"\)[\s\S]*?cache: new D1ProviderCache\("fmp"\)/,
  );
  assert.match(
    runnerSource,
    /return unique\(\[[\s\S]*?\.\.\.holdings\.map\(researchSymbolForHolding\),[\s\S]*?\.\.\.settings\.watchlist/,
    "holdings must consume the four trial slots before watchlist symbols",
  );
});

test("stale-fallback quotes cannot mutate paper tracking", () => {
  assert.match(
    runnerSource,
    /const staleFallbackQuote =[\s\S]*?bundle\.quote\.meta\.cache\.state === "stale-fallback"/,
  );
  assert.match(
    runnerSource,
    /if \(input\.settings\.paperTrialStartedAt && staleFallbackQuote\) \{[\s\S]*?expired cache fallback cannot settle queued trades, record paper observations, or queue paper actions[\s\S]*?\} else if \([\s\S]*?settleQueuedPaperTrades\([\s\S]*?recordPaperObservation\([\s\S]*?queuePaperDecision\(/,
  );
});

test("trial UI explains the four-symbol, scheduled-refresh policy", () => {
  assert.match(dashboardSource, /Manual reviews use the saved cache/);
  assert.match(
    settingsSource,
    /Trial scheduled research covers four unique symbols, with holdings first/,
  );
  assert.match(settingsSource, /Maximum 4/);
  assert.match(researchSource, /Alpha trial manual reruns use saved cache/);
});
