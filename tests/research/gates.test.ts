import assert from "node:assert/strict";
import test from "node:test";

import {
  FULL_RESEARCH_FRESHNESS_POLICY,
  assessConflicts,
  assessEvidenceQuality,
  assessFreshness,
  type ConflictObservation,
  type ResearchArtifact,
} from "../../lib/research/freshness";
import {
  LIVE_LABEL_REQUIREMENTS,
  evaluateOperationalReadiness,
  type OperationalReadinessInput,
} from "../../lib/research/readiness";
import {
  ALPHA_VANTAGE_TRIAL_PROFILE,
  FMP_FULL_PROFILE,
  selectResearchSymbols,
} from "../../lib/research/providers/contracts";
import type { GateAssessment } from "../../lib/research/types";
import {
  assessSafetyUniverse,
  type SafetyUniverseSecurity,
} from "../../lib/research/universe";

const now = new Date("2026-07-23T14:00:00.000Z");
const passGate: GateAssessment = { status: "pass", reasons: [] };

function requiredArtifacts(): ResearchArtifact[] {
  return [
    {
      id: "quote",
      kind: "quote",
      source: "fmp",
      asOf: "2026-07-23T13:50:00.000Z",
      fetchedAt: "2026-07-23T13:51:00.000Z",
      cacheState: "miss",
    },
    {
      id: "fundamentals",
      kind: "fundamentals",
      source: "fmp",
      asOf: "2026-06-30T00:00:00.000Z",
      fetchedAt: "2026-07-23T12:00:00.000Z",
      cacheState: "hit",
    },
    {
      id: "news",
      kind: "news",
      source: "fmp",
      asOf: "2026-07-23T10:00:00.000Z",
      fetchedAt: "2026-07-23T12:00:00.000Z",
      cacheState: "hit",
    },
    {
      id: "portfolio",
      kind: "portfolio",
      source: "local-ledger",
      asOf: "2026-07-23T13:30:00.000Z",
      fetchedAt: "2026-07-23T13:30:00.000Z",
    },
  ];
}

test("freshness and source-conflict gates block unsafe evidence", () => {
  const fresh = assessFreshness(
    requiredArtifacts(),
    now,
    FULL_RESEARCH_FRESHNESS_POLICY,
  );
  assert.equal(fresh.status, "pass");

  const stale = assessFreshness(
    requiredArtifacts().map((artifact) =>
      artifact.kind === "quote"
        ? { ...artifact, asOf: "2026-07-23T12:00:00.000Z" }
        : artifact,
    ),
    now,
    FULL_RESEARCH_FRESHNESS_POLICY,
  );
  assert.equal(stale.status, "block");
  assert.deepEqual(stale.staleArtifactIds, ["quote"]);

  const withinTolerance: ConflictObservation[] = [
    {
      field: "price",
      source: "fmp",
      value: 100,
      asOf: now.toISOString(),
    },
    {
      field: "price",
      source: "broker-check",
      value: 100.5,
      asOf: now.toISOString(),
    },
  ];
  assert.equal(assessConflicts(withinTolerance).status, "pass");

  const conflicting = withinTolerance.map((item, index) =>
    index === 1 ? { ...item, value: 105 } : item,
  );
  const quality = assessEvidenceQuality(
    requiredArtifacts(),
    conflicting,
    now,
    FULL_RESEARCH_FRESHNESS_POLICY,
  );
  assert.equal(quality.status, "block");
  assert.equal(quality.conflicts.conflicts[0]?.field, "price");
});

test("trial provider enforces a maximum four-symbol research batch", () => {
  const symbols = ["RY.TRT", "TD.TRT", "SHOP.TRT", "AAPL", "MSFT", "NVDA"];
  const trial = selectResearchSymbols(
    symbols,
    ALPHA_VANTAGE_TRIAL_PROFILE,
  );
  assert.equal(trial.withinLimit, false);
  assert.deepEqual(trial.accepted, symbols.slice(0, 4));
  assert.deepEqual(trial.rejected, ["MSFT", "NVDA"]);
  assert.equal(trial.limit, 4);

  const full = selectResearchSymbols(symbols, FMP_FULL_PROFILE);
  assert.equal(full.withinLimit, true);
  assert.deepEqual(full.accepted, symbols);
});

function safeStock(
  overrides: Partial<SafetyUniverseSecurity> = {},
): SafetyUniverseSecurity {
  return {
    symbol: "RY.TO",
    exchange: "TSX",
    currency: "CAD",
    assetType: "common-stock",
    price: 180,
    marketCap: 250_000_000_000,
    fundAssets: null,
    averageDailyDollarVolume: 200_000_000,
    isBroadMarketEtf: false,
    isLeveraged: false,
    isInverse: false,
    isHalted: false,
    isDelisted: false,
    isWealthsimpleEligible: true,
    ...overrides,
  };
}

test("safety universe only accepts liquid large caps and broad ETFs", () => {
  assert.equal(assessSafetyUniverse(safeStock()).eligible, true);
  assert.equal(
    assessSafetyUniverse(safeStock({ exchange: "OTC" })).eligible,
    false,
  );
  assert.equal(
    assessSafetyUniverse(safeStock({ price: 2 })).reasons.some(
      (item) => item.code === "penny-stock-excluded",
    ),
    true,
  );
  assert.equal(
    assessSafetyUniverse(
      safeStock({ marketCap: 500_000_000 }),
    ).reasons.some((item) => item.code === "microcap-excluded"),
    true,
  );
  assert.equal(
    assessSafetyUniverse(
      safeStock({
        assetType: "etf",
        marketCap: null,
        fundAssets: 50_000_000_000,
        isBroadMarketEtf: true,
        isLeveraged: true,
      }),
    ).eligible,
    false,
  );
  assert.equal(assessSafetyUniverse(safeStock(), "short").eligible, false);
  assert.equal(assessSafetyUniverse(safeStock(), "day-trade").eligible, false);
});

function readinessInput(
  overrides: Partial<OperationalReadinessInput> = {},
): OperationalReadinessInput {
  return {
    provider: FMP_FULL_PROFILE,
    evaluationDate: "2026-07-31",
    paperTrial: {
      startedOn: "2026-07-01",
      completedMarketSessions: 20,
      scheduledRuns: 40,
      successfulRuns: 38,
      reconciliationPassed: true,
      unresolvedDataQualityFailures: 0,
    },
    quoteEntitlementVerified: true,
    explicitUserAcknowledgementAt: "2026-07-31T12:00:00.000Z",
    confidence: "high",
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
    ...overrides,
  };
}

test("live labels require full provider and the complete paper trial", () => {
  assert.deepEqual(LIVE_LABEL_REQUIREMENTS, {
    calendarDays: 30,
    marketSessions: 20,
    scheduledRunReliability: 0.95,
  });

  const ready = evaluateOperationalReadiness(readinessInput());
  assert.equal(ready.canUseLiveActionLabels, true);
  assert.equal(ready.displayMode, "live-data-research");
  assert.equal(ready.autoTradingAllowed, false);
  assert.equal(ready.requiresManualOrderConfirmation, true);

  const trialProvider = evaluateOperationalReadiness(
    readinessInput({ provider: ALPHA_VANTAGE_TRIAL_PROFILE }),
  );
  assert.equal(trialProvider.canUseLiveActionLabels, false);
  assert.equal(trialProvider.displayMode, "trial-research");

  const shortTrial = evaluateOperationalReadiness(
    readinessInput({
      evaluationDate: "2026-07-30",
      paperTrial: {
        ...readinessInput().paperTrial,
        completedMarketSessions: 19,
      },
    }),
  );
  assert.equal(shortTrial.canUseLiveActionLabels, false);
  assert.equal(shortTrial.displayMode, "paper-trial");

  const unreliable = evaluateOperationalReadiness(
    readinessInput({
      paperTrial: {
        ...readinessInput().paperTrial,
        successfulRuns: 37,
      },
    }),
  );
  assert.equal(unreliable.canUseLiveActionLabels, false);

  const unacknowledged = evaluateOperationalReadiness(
    readinessInput({ explicitUserAcknowledgementAt: null }),
  );
  assert.equal(unacknowledged.canUseLiveActionLabels, false);

  const invalidPortfolio = evaluateOperationalReadiness(
    readinessInput({
      portfolioRiskGate: {
        status: "block",
        reasons: [
          {
            code: "portfolio-data-invalid",
            message: "The portfolio ledger has unresolved diagnostics.",
          },
        ],
      },
    }),
  );
  assert.equal(invalidPortfolio.canUseLiveActionLabels, false);
  assert.equal(
    invalidPortfolio.blockers.some(
      (blocker) => blocker.code === "portfolio-data-invalid",
    ),
    true,
  );

  const notStarted = evaluateOperationalReadiness(
    readinessInput({
      paperTrial: {
        ...readinessInput().paperTrial,
        startedOn: null,
      },
    }),
  );
  assert.equal(notStarted.canUseLiveActionLabels, false);
  assert.equal(
    notStarted.blockers.some(
      (blocker) => blocker.code === "paper-trial-not-started",
    ),
    true,
  );
});
