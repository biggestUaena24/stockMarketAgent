import assert from "node:assert/strict";
import test from "node:test";

import {
  AlphaVantageTrialProvider,
  FmpFullProvider,
  MemoryProviderCache,
  requestJson,
} from "../../lib/research/providers/index";
import { FMP_FULL_PROFILE } from "../../lib/research/providers/contracts";

const fixedNow = () => new Date("2026-07-23T14:00:00.000Z");

test("provider adapters fail gracefully when credentials are missing", async () => {
  const alpha = await new AlphaVantageTrialProvider({
    now: fixedNow,
  }).getQuote("AAPL");
  assert.equal(alpha.ok, false);
  if (!alpha.ok) {
    assert.equal(alpha.error.code, "configuration");
    assert.equal(alpha.error.retryable, false);
  }

  const fmp = await new FmpFullProvider({ now: fixedNow }).getQuote("RY.TO");
  assert.equal(fmp.ok, false);
  if (!fmp.ok) {
    assert.equal(fmp.error.code, "configuration");
  }
});

test("Alpha Vantage quote normalization includes safe cache metadata", async () => {
  let fetchCount = 0;
  const cache = new MemoryProviderCache();
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    fetcher: async () => {
      fetchCount += 1;
      return Response.json({
        "Global Quote": {
          "01. symbol": "AAPL",
          "05. price": "215.50",
          "06. volume": "123456",
          "07. latest trading day": "2026-07-22",
          "08. previous close": "210.00",
          "10. change percent": "2.6190%",
        },
      });
    },
  });

  const first = await provider.getQuote("AAPL");
  const second = await provider.getQuote("AAPL");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.data.price, 215.5);
    assert.equal(first.data.changePercent, 2.619);
    assert.equal(first.meta.endpoint.includes("test-secret"), false);
    assert.equal(first.meta.cache.state, "miss");
    assert.equal(second.meta.cache.state, "hit");
  }
  assert.equal(fetchCount, 1);
});

test("HTTP layer returns expired cache only as an explicit stale fallback", async () => {
  const cache = new MemoryProviderCache();
  await cache.set("quote:RY", {
    data: { value: 100 },
    storedAt: "2026-07-23T12:00:00.000Z",
    expiresAt: "2026-07-23T12:01:00.000Z",
  });

  const result = await requestJson<{ value: number }>({
    profile: FMP_FULL_PROFILE,
    operation: "quote",
    url: new URL("https://example.test/quote?apikey=secret"),
    cacheKey: "quote:RY",
    cacheTtlMs: 60_000,
    cache,
    now: fixedNow,
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.value, 100);
    assert.equal(result.meta.cache.state, "stale-fallback");
    assert.equal(result.meta.endpoint.includes("secret"), false);
    assert.match(result.meta.warnings.at(-1) ?? "", /must not receive a live label/i);
  }
});
