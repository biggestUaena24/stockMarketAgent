import assert from "node:assert/strict";
import test from "node:test";

import {
  assessResearchRunQuality,
  completedMarketSessionDates,
  isDataQualityFailure,
  isSuccessfulResearchRun,
  paperTrialScheduledRuns,
  summarizePaperTrialReadiness,
} from "../../lib/research/run-accounting";
import { requiredResearchSetupReady } from "../../lib/research/setup-readiness";

const startedAt = "2026-08-01T00:00:00.000Z";

test("paper-trial reliability only includes scheduled runs after explicit start", () => {
  const rows = [
    {
      idempotencyKey: "manual:before-start",
      actualTime: "2026-08-02T13:30:00.000Z",
      status: "degraded",
      dataFreshness: "limited",
      errors: ["Email delivery: not configured"],
    },
    {
      idempotencyKey: "2026-07-31:morning",
      actualTime: "2026-07-31T13:30:00.000Z",
      status: "degraded",
      dataFreshness: "limited",
      errors: [],
    },
    {
      idempotencyKey: "2026-08-03:morning",
      actualTime: "2026-08-03T13:30:00.000Z",
      status: "complete",
      dataFreshness: "verified",
      errors: ["Email delivery: Resend is unavailable"],
    },
    {
      idempotencyKey: "2026-08-03:evening",
      actualTime: "2026-08-03T23:30:00.000Z",
      status: "degraded",
      dataFreshness: "limited",
      errors: [],
    },
  ];

  const counted = paperTrialScheduledRuns(rows, startedAt);
  assert.deepEqual(
    counted.map((row) => row.idempotencyKey),
    ["2026-08-03:morning", "2026-08-03:evening"],
  );
  assert.equal(counted.filter(isSuccessfulResearchRun).length, 1);
  assert.equal(counted.filter(isDataQualityFailure).length, 1);
});

test("paper-trial accounting remains empty until the owner starts it", () => {
  assert.deepEqual(
    paperTrialScheduledRuns(
      [
        {
          idempotencyKey: "2026-08-03:morning",
          actualTime: "2026-08-03T13:30:00.000Z",
          status: "complete",
          dataFreshness: "verified",
          errors: [],
        },
      ],
      null,
    ),
    [],
  );
});

test("success requires verified data and ignores notification-only diagnostics", () => {
  const base = {
    status: "complete",
    dataFreshness: "verified",
    errors: ["Email delivery: Resend is unavailable"],
  };
  assert.equal(isSuccessfulResearchRun(base), true);
  assert.equal(isDataQualityFailure(base), false);

  const limited = { ...base, dataFreshness: "limited" };
  assert.equal(isSuccessfulResearchRun(limited), false);
  assert.equal(isDataQualityFailure(limited), true);

  const diagnosed = {
    ...base,
    errors: [
      "Email delivery: Resend is unavailable",
      "SHOP.TO: current quote is stale",
    ],
  };
  assert.equal(isSuccessfulResearchRun(diagnosed), false);
  assert.equal(isDataQualityFailure(diagnosed), true);
});

test("partial research and portfolio diagnostics degrade run quality", () => {
  const clean = assessResearchRunQuality({
    providerConfigured: true,
    acceptedSymbolCount: 2,
    recommendationCount: 2,
    blockedByDataCount: 0,
    researchDiagnostics: [],
    portfolioDiagnostics: [],
  });
  assert.deepEqual(clean, {
    status: "complete",
    dataFreshness: "verified",
  });

  assert.deepEqual(
    assessResearchRunQuality({
      providerConfigured: true,
      acceptedSymbolCount: 2,
      recommendationCount: 2,
      blockedByDataCount: 1,
      researchDiagnostics: [],
      portfolioDiagnostics: [],
    }),
    { status: "degraded", dataFreshness: "limited" },
  );
  assert.deepEqual(
    assessResearchRunQuality({
      providerConfigured: true,
      acceptedSymbolCount: 2,
      recommendationCount: 2,
      blockedByDataCount: 0,
      researchDiagnostics: [],
      portfolioDiagnostics: ["A sale exceeds the tracked position."],
    }),
    { status: "degraded", dataFreshness: "limited" },
  );
});

test("market-session accounting uses saved open state and excludes holidays", () => {
  const common = {
    status: "complete",
    dataFreshness: "verified",
    errors: [] as string[],
  };
  const dates = completedMarketSessionDates([
    {
      ...common,
      idempotencyKey: "2026-12-24:morning",
      actualTime: "2026-12-24T14:30:00.000Z",
      marketState: { localDate: "2026-12-24", anyOpen: true },
    },
    {
      ...common,
      idempotencyKey: "2026-12-24:evening",
      actualTime: "2026-12-24T23:30:00.000Z",
      marketStateJson: JSON.stringify({
        localDate: "2026-12-24",
        anyOpen: true,
      }),
    },
    {
      ...common,
      idempotencyKey: "2026-12-25:morning",
      actualTime: "2026-12-25T14:30:00.000Z",
      marketState: { localDate: "2026-12-25", anyOpen: false },
    },
    {
      ...common,
      idempotencyKey: "2026-12-28:morning",
      actualTime: "2026-12-28T14:30:00.000Z",
      dataFreshness: "limited",
      marketState: { localDate: "2026-12-28", anyOpen: true },
    },
  ]);
  assert.deepEqual(dates, ["2026-12-24"]);
});

test("paper readiness summarizes the complete post-start scheduled dataset", () => {
  const rows = Array.from({ length: 140 }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    const month = String(Math.floor(index / 28) + 1).padStart(2, "0");
    const localDate = `2026-${month}-${day}`;
    return {
      idempotencyKey: `${localDate}:${index % 2 === 0 ? "morning" : "evening"}`,
      actualTime: `${localDate}T14:30:00.000Z`,
      status: index === 139 ? "degraded" : "complete",
      dataFreshness: index === 139 ? "limited" : "verified",
      errors: [] as string[],
      marketState: { localDate, anyOpen: true },
    };
  });
  rows.push({
    idempotencyKey: "manual:ignored",
    actualTime: "2026-06-01T14:30:00.000Z",
    status: "complete",
    dataFreshness: "verified",
    errors: [],
    marketState: { localDate: "2026-06-01", anyOpen: true },
  });

  const summary = summarizePaperTrialReadiness(
    rows,
    "2025-12-31T00:00:00.000Z",
  );
  assert.equal(summary.scheduledRuns, 140);
  assert.equal(summary.successfulRuns, 139);
  assert.equal(summary.unresolvedDataQualityFailures, 1);
  assert.equal(summary.completedMarketSessions, 139);
});

test("optional OpenAI and email services do not block required setup", () => {
  assert.equal(
    requiredResearchSetupReady({
      onboardingComplete: true,
      providerMode: "trial",
      alphaVantageConfigured: true,
      fmpConfigured: false,
      schedulerSecretConfigured: true,
    }),
    true,
  );
  assert.equal(
    requiredResearchSetupReady({
      onboardingComplete: true,
      providerMode: "trial",
      alphaVantageConfigured: true,
      fmpConfigured: false,
      schedulerSecretConfigured: false,
    }),
    false,
  );
  assert.equal(
    requiredResearchSetupReady({
      onboardingComplete: true,
      providerMode: "full",
      alphaVantageConfigured: true,
      fmpConfigured: false,
      schedulerSecretConfigured: true,
    }),
    false,
  );
});
