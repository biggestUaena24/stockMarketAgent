import assert from "node:assert/strict";
import test from "node:test";

import {
  AlphaVantageTrialProvider,
  FmpFullProvider,
  InMemoryProviderRequestBudget,
  MemoryProviderCache,
  requestJson,
  type ProviderRequestBudget,
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

test("Alpha Vantage serializes free-tier network requests with spacing", async () => {
  let clock = 0;
  const startedAt: number[] = [];
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    now: fixedNow,
    clockMs: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    fetcher: async (input) => {
      startedAt.push(clock);
      const url = new URL(String(input));
      const symbol = url.searchParams.get("symbol") ?? "UNKNOWN";
      return Response.json({
        "Global Quote": {
          "01. symbol": symbol,
          "05. price": "100",
          "07. latest trading day": "2026-07-22",
        },
      });
    },
  });

  const results = await Promise.all([
    provider.getQuote("AAPL"),
    provider.getQuote("MSFT"),
    provider.getQuote("GOOG"),
  ]);
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(startedAt, [0, 2_100, 4_200]);
});

test("Alpha Vantage serializes the complete request lifecycle", async () => {
  const started: string[] = [];
  let releaseFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    releaseFirst = resolve;
  });
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async (input) => {
      const symbol = new URL(String(input)).searchParams.get("symbol") ?? "";
      started.push(symbol);
      if (started.length === 1) return firstResponse;
      return quoteResponse(symbol);
    },
  });

  const first = provider.getQuote("AAPL");
  const second = provider.getQuote("MSFT");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["AAPL"]);

  releaseFirst(quoteResponse("AAPL"));
  const results = await Promise.all([first, second]);
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(started, ["AAPL", "MSFT"]);
});

test("Alpha Vantage reserves budget only after a cache miss", async () => {
  const cache = new MemoryProviderCache();
  const cacheKey =
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}';
  await cache.set(cacheKey, {
    data: quotePayload("AAPL"),
    storedAt: "2026-07-23T13:30:00.000Z",
    expiresAt: "2026-07-23T14:30:00.000Z",
  });
  const reservations: string[] = [];
  const requestBudget: ProviderRequestBudget = {
    reserve(input) {
      reservations.push(input.operation);
      return {
        allowed: true,
        scheduledAtMs: input.nowMs,
        usedCount: reservations.length,
        limit: 25,
      };
    },
  };
  let fetchCount = 0;
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    requestBudget,
    fetcher: async () => {
      fetchCount += 1;
      return Response.json({ Symbol: "MSFT", Name: "Microsoft" });
    },
  });

  const quote = await provider.getQuote("AAPL");
  const facts = await provider.getCompanyFacts("MSFT");
  assert.equal(quote.ok, true);
  assert.equal(facts.ok, true);
  assert.deepEqual(reservations, ["company-facts"]);
  assert.equal(fetchCount, 1);
});

test("Alpha Vantage cache-only misses never use the network", async () => {
  let fetchCount = 0;
  let reserveCount = 0;
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cacheOnly: true,
    requestBudget: {
      reserve(input) {
        reserveCount += 1;
        return {
          allowed: true,
          scheduledAtMs: input.nowMs,
          usedCount: reserveCount,
          limit: 25,
        };
      },
    },
    fetcher: async () => {
      fetchCount += 1;
      return quoteResponse("AAPL");
    },
  });

  const result = await provider.getQuote("AAPL");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported");
    assert.match(result.error.message, /cache-only mode/i);
  }
  assert.equal(reserveCount, 0);
  assert.equal(fetchCount, 0);
});

test("Alpha Vantage cache-only mode returns an expired valid entry explicitly as stale", async () => {
  const cache = new MemoryProviderCache();
  await cache.set(
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
    {
      data: quotePayload("AAPL"),
      storedAt: "2026-07-23T12:00:00.000Z",
      expiresAt: "2026-07-23T13:00:00.000Z",
    },
  );
  const result = await new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    cacheOnly: true,
    now: fixedNow,
  }).getQuote("AAPL");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.meta.cache.state, "stale-fallback");
    assert.match(result.meta.warnings.at(-1) ?? "", /cache-only mode/i);
  }
});

test("Alpha Vantage redacts a key echoed by an upstream error", async () => {
  const apiKey = "SECRETKEY123456";
  const cache = new MemoryProviderCache();
  const result = await new AlphaVantageTrialProvider({
    apiKey,
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async () =>
      Response.json({
        Information: `We have detected your API key as ${apiKey} and rate limited the request.`,
      }),
  }).getQuote("AAPL");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.message.includes(apiKey), false);
    assert.match(result.error.message, /\[REDACTED\]/);
  }
  const cached = await cache.get(
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
  );
  assert.equal(cached, null);
});

test("Alpha Vantage detects case-insensitive rate-limit envelopes and opens a run circuit", async () => {
  let fetchCount = 0;
  let reserveCount = 0;
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    requestSpacingMs: 0,
    requestBudget: {
      reserve(input) {
        reserveCount += 1;
        return {
          allowed: true,
          scheduledAtMs: input.nowMs,
          usedCount: reserveCount,
          limit: 25,
        };
      },
    },
    fetcher: async () => {
      fetchCount += 1;
      return Response.json({
        "  iNfOrMaTiOn  ":
          "Please contact premium@alphavantage.co if you are targeting a higher API call volume.",
      });
    },
  });

  const first = await provider.getQuote("AAPL");
  const second = await provider.getCompanyFacts("MSFT");
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (!first.ok) assert.equal(first.error.code, "rate-limit");
  if (!second.ok) {
    assert.equal(second.error.code, "rate-limit");
    assert.match(second.error.message, /stopped for this run/i);
  }
  assert.equal(fetchCount, 1);
  assert.equal(reserveCount, 1);
});

test("Alpha Vantage rejects and evicts provider-error payloads instead of caching them", async () => {
  let fetchCount = 0;
  const cache = new MemoryProviderCache();
  const cacheKey =
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}';
  await cache.set(cacheKey, {
    data: { Information: "A cached rate-limit response." },
    storedAt: "2026-07-23T13:00:00.000Z",
    expiresAt: "2026-07-24T13:00:00.000Z",
  });
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async () => {
      fetchCount += 1;
      return Response.json({
        "Global Quote": {
          "01. symbol": "AAPL",
          "05. price": "101",
          "07. latest trading day": "2026-07-22",
        },
      });
    },
  });

  const result = await provider.getQuote("AAPL");
  assert.equal(result.ok, true);
  assert.equal(fetchCount, 1);
  const cached = await cache.get<Record<string, unknown>>(cacheKey);
  assert.equal("Information" in (cached?.data ?? {}), false);
});

test("Alpha Vantage validates response shapes before caching", async () => {
  const cases = [
    {
      operation: "quote",
      cacheKey:
        'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
      request(provider: AlphaVantageTrialProvider) {
        return provider.getQuote("AAPL");
      },
    },
    {
      operation: "company-facts",
      cacheKey:
        'alpha-vantage:company-facts:{"function":"OVERVIEW","symbol":"AAPL"}',
      request(provider: AlphaVantageTrialProvider) {
        return provider.getCompanyFacts("AAPL");
      },
    },
    {
      operation: "company-news",
      cacheKey:
        'alpha-vantage:company-news:{"function":"NEWS_SENTIMENT","tickers":"AAPL","sort":"LATEST","limit":"20"}',
      request(provider: AlphaVantageTrialProvider) {
        return provider.getNews("AAPL");
      },
    },
  ] as const;

  for (const item of cases) {
    const cache = new MemoryProviderCache();
    const result = await item.request(
      new AlphaVantageTrialProvider({
        apiKey: "test-secret",
        cache,
        requestSpacingMs: 0,
        fetcher: async () => Response.json({}),
      }),
    );
    assert.equal(result.ok, false, item.operation);
    if (!result.ok) {
      assert.equal(result.error.code, "malformed-response", item.operation);
    }
    assert.equal(await cache.get(item.cacheKey), null, item.operation);
  }
});

test("Alpha Vantage refetches after a malformed payload instead of poisoning cache", async () => {
  let fetchCount = 0;
  const cache = new MemoryProviderCache();
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    requestSpacingMs: 0,
    fetcher: async () => {
      fetchCount += 1;
      return fetchCount === 1 ? Response.json({}) : quoteResponse("AAPL");
    },
  });

  const malformed = await provider.getQuote("AAPL");
  const recovered = await provider.getQuote("AAPL");
  assert.equal(malformed.ok, false);
  assert.equal(recovered.ok, true);
  assert.equal(fetchCount, 2);
});

test("Alpha Vantage uses valid stale cache for malformed JSON", async () => {
  const cache = new MemoryProviderCache();
  await cache.set(
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
    {
      data: quotePayload("AAPL"),
      storedAt: "2026-07-23T12:00:00.000Z",
      expiresAt: "2026-07-23T13:00:00.000Z",
    },
  );
  const result = await new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  }).getQuote("AAPL");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.price, 100);
    assert.equal(result.meta.cache.state, "stale-fallback");
    assert.match(result.meta.warnings.at(-1) ?? "", /invalid JSON/i);
  }
});

test("Alpha Vantage uses valid stale cache for a malformed success payload", async () => {
  const cache = new MemoryProviderCache();
  await cache.set(
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
    {
      data: quotePayload("AAPL"),
      storedAt: "2026-07-23T12:00:00.000Z",
      expiresAt: "2026-07-23T13:00:00.000Z",
    },
  );
  const result = await new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async () => Response.json({}),
  }).getQuote("AAPL");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.price, 100);
    assert.equal(result.meta.cache.state, "stale-fallback");
    assert.match(result.meta.warnings.at(-1) ?? "", /no usable quote/i);
  }
});

test("Alpha Vantage opens its circuit even when a rate-limit payload uses stale cache", async () => {
  const cache = new MemoryProviderCache();
  await cache.set(
    'alpha-vantage:quote:{"function":"GLOBAL_QUOTE","symbol":"AAPL"}',
    {
      data: quotePayload("AAPL"),
      storedAt: "2026-07-23T12:00:00.000Z",
      expiresAt: "2026-07-23T13:00:00.000Z",
    },
  );
  let fetchCount = 0;
  const provider = new AlphaVantageTrialProvider({
    apiKey: "test-secret",
    cache,
    now: fixedNow,
    requestSpacingMs: 0,
    fetcher: async () => {
      fetchCount += 1;
      return Response.json({
        Note: "The API request frequency limit has been reached.",
      });
    },
  });

  const stale = await provider.getQuote("AAPL");
  const stopped = await provider.getCompanyFacts("MSFT");
  assert.equal(stale.ok, true);
  if (stale.ok) assert.equal(stale.meta.cache.state, "stale-fallback");
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.match(stopped.error.message, /stopped for this run/i);
  assert.equal(fetchCount, 1);
});

test("in-memory provider budget spaces requests and enforces its daily boundary", async () => {
  const budget = new InMemoryProviderRequestBudget({ limit: 2 });
  const first = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:AAPL",
    nowMs: 0,
    spacingMs: 2_100,
  });
  const second = await budget.reserve({
    operation: "company-facts",
    cacheKey: "facts:AAPL",
    nowMs: 0,
    spacingMs: 2_100,
  });
  const blocked = await budget.reserve({
    operation: "company-news",
    cacheKey: "news:AAPL",
    nowMs: 0,
    spacingMs: 2_100,
  });
  const nextDay = await budget.reserve({
    operation: "quote",
    cacheKey: "quote:AAPL",
    nowMs: 24 * 60 * 60 * 1_000,
    spacingMs: 2_100,
  });

  assert.deepEqual(first, {
    allowed: true,
    scheduledAtMs: 0,
    usedCount: 1,
    limit: 2,
  });
  assert.deepEqual(second, {
    allowed: true,
    scheduledAtMs: 2_100,
    usedCount: 2,
    limit: 2,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    usedCount: 2,
    limit: 2,
    retryAt: 24 * 60 * 60 * 1_000,
  });
  assert.deepEqual(nextDay, {
    allowed: true,
    scheduledAtMs: 24 * 60 * 60 * 1_000,
    usedCount: 1,
    limit: 2,
  });
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

function quotePayload(symbol: string) {
  return {
    "Global Quote": {
      "01. symbol": symbol,
      "05. price": "100",
      "07. latest trading day": "2026-07-22",
    },
  };
}

function quoteResponse(symbol: string): Response {
  return Response.json(quotePayload(symbol));
}
