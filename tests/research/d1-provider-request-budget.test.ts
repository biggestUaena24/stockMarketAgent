import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

import {
  DEFAULT_ALPHA_DAILY_REQUEST_LIMIT,
  D1ProviderRequestBudget,
} from "../../lib/d1-provider-request-budget.js";

interface FakeD1Observation {
  statements: string[];
  bindings: unknown[][];
  firstCalls: number;
}

function fakeD1(
  result: Record<string, unknown> | null,
  error?: Error,
): { database: D1Database; observation: FakeD1Observation } {
  const observation: FakeD1Observation = {
    statements: [],
    bindings: [],
    firstCalls: 0,
  };
  const database = {
    prepare(statement: string) {
      observation.statements.push(statement);
      return {
        bind(...values: unknown[]) {
          observation.bindings.push(values);
          return {
            async first() {
              observation.firstCalls += 1;
              if (error) throw error;
              return result;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { database, observation };
}

function sqliteD1(): { database: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE provider_request_budgets (
      provider TEXT NOT NULL,
      credential_fingerprint TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      scheduled_start_ms INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, credential_fingerprint, quota_date)
    )
  `);
  const database = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              return (
                sqlite.prepare(query).get(...(values as SQLInputValue[])) ?? null
              );
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { database, sqlite };
}

test("atomically reserves a globally spaced request without storing secrets", async () => {
  const rawCredential = "do-not-store-this-alpha-key";
  const cacheKey =
    "https://www.alphavantage.co/query?apikey=also-do-not-store-this-url";
  const nowMs = Date.parse("2026-08-24T18:15:30.000Z");
  const scheduledAtMs = nowMs + 2_100;
  const { database, observation } = fakeD1({
    used_count: 7,
    scheduled_start_ms: scheduledAtMs,
  });
  const budget = new D1ProviderRequestBudget({
    provider: "alpha-vantage",
    credential: ` ${rawCredential} `,
    dailyLimit: DEFAULT_ALPHA_DAILY_REQUEST_LIMIT,
    database,
  });

  const reservation = await budget.reserve({
    operation: "quote",
    cacheKey,
    nowMs,
    spacingMs: 2_100,
  });

  assert.deepEqual(reservation, {
    allowed: true,
    scheduledAtMs,
    usedCount: 7,
    limit: 24,
  });
  assert.equal(observation.statements.length, 1);
  assert.equal(observation.bindings.length, 1);
  assert.equal(observation.firstCalls, 1);

  const statement = observation.statements[0];
  assert.match(statement, /INSERT INTO provider_request_budgets/i);
  assert.match(statement, /ON CONFLICT\s*\(provider, credential_fingerprint, quota_date\)/i);
  assert.match(statement, /DO UPDATE SET/i);
  assert.match(statement, /WHERE provider_request_budgets\.used_count < \?/i);
  assert.match(statement, /RETURNING used_count, scheduled_start_ms/i);
  assert.match(statement, /SELECT MAX\(scheduled_start_ms \+ \?\)/i);

  const fingerprint = createHash("sha256")
    .update(rawCredential)
    .digest("hex");
  assert.deepEqual(observation.bindings[0], [
    "alpha-vantage",
    fingerprint,
    "2026-08-24",
    nowMs,
    2_100,
    "alpha-vantage",
    fingerprint,
    nowMs,
    24,
  ]);
  const persistedInput = `${statement}\n${JSON.stringify(observation.bindings)}`;
  assert.equal(persistedInput.includes(rawCredential), false);
  assert.equal(persistedInput.includes(cacheKey), false);
  assert.equal(persistedInput.includes("also-do-not-store-this-url"), false);
});

test("uses the UTC quota date and denies the twenty-fifth request", async () => {
  const nowMs = Date.parse("2026-01-01T00:30:00.000Z");
  const { database, observation } = fakeD1(null);
  const budget = new D1ProviderRequestBudget({
    provider: "alpha-vantage",
    credential: "test-key",
    dailyLimit: 24,
    database,
  });

  const reservation = await budget.reserve({
    operation: "fundamentals",
    cacheKey: "alpha-vantage:fundamentals:TEST",
    nowMs,
    spacingMs: 2_100,
  });

  assert.deepEqual(reservation, {
    allowed: false,
    usedCount: 24,
    limit: 24,
    retryAt: Date.parse("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(observation.bindings[0][2], "2026-01-01");
  assert.equal(observation.firstCalls, 1);
});

test("the atomic SQLite statement enforces quota and spacing across UTC midnight", async (t) => {
  const { database, sqlite } = sqliteD1();
  t.after(() => sqlite.close());
  const budget = new D1ProviderRequestBudget({
    provider: "alpha-vantage",
    credential: "test-key",
    dailyLimit: 2,
    database,
  });
  const firstNow = Date.parse("2026-08-24T23:59:59.500Z");

  const first = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:first",
    nowMs: firstNow,
    spacingMs: 2_100,
  });
  const second = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:second",
    nowMs: firstNow,
    spacingMs: 2_100,
  });
  const denied = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:denied",
    nowMs: firstNow,
    spacingMs: 2_100,
  });
  const afterMidnight = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:new-day",
    nowMs: Date.parse("2026-08-25T00:00:00.000Z"),
    spacingMs: 2_100,
  });

  assert.equal(first.allowed && first.scheduledAtMs, firstNow);
  assert.equal(second.allowed && second.scheduledAtMs, firstNow + 2_100);
  assert.equal(denied.allowed, false);
  assert.equal(
    afterMidnight.allowed && afterMidnight.scheduledAtMs,
    firstNow + 4_200,
  );
});

test("propagates D1 failures so callers cannot send an unreserved request", async () => {
  const expected = new Error("D1 unavailable");
  const { database } = fakeD1(null, expected);
  const budget = new D1ProviderRequestBudget({
    provider: "alpha-vantage",
    credential: "test-key",
    dailyLimit: 24,
    database,
  });

  await assert.rejects(
    budget.reserve({
      operation: "news",
      cacheKey: "alpha-vantage:news:TEST",
      nowMs: Date.parse("2026-08-24T18:15:30.000Z"),
      spacingMs: 2_100,
    }),
    expected,
  );
});

test("rejects malformed reservation rows rather than allowing a request", async () => {
  const { database } = fakeD1({
    used_count: 25,
    scheduled_start_ms: Date.now(),
  });
  const budget = new D1ProviderRequestBudget({
    provider: "alpha-vantage",
    credential: "test-key",
    dailyLimit: 24,
    database,
  });

  await assert.rejects(
    budget.reserve({
      operation: "quote",
      cacheKey: "alpha-vantage:quote:TEST",
      nowMs: Date.parse("2026-08-24T18:15:30.000Z"),
      spacingMs: 2_100,
    }),
    /invalid count/i,
  );
});
