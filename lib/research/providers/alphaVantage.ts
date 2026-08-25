import type {
  MarketResearchProvider,
  NewsQuery,
  NormalizedAnalystEstimates,
  NormalizedCompanyFacts,
  NormalizedNewsItem,
  NormalizedQuote,
  ProviderError,
  ProviderResult,
} from "../types";
import { ALPHA_VANTAGE_TRIAL_PROFILE, unsupportedResult } from "./contracts";
import {
  configurationError,
  malformedResponse,
  requestJson,
  type FetchLike,
  type ProviderCache,
} from "./http";
import {
  InMemoryProviderRequestBudget,
  type ProviderRequestBudget,
} from "./request-budget";
import {
  clampSentiment,
  finiteInteger,
  finiteNumber,
  isoDate,
  normalizeAssetType,
  normalizeCurrency,
  normalizeExchange,
  normalizedRatio,
  stableNewsId,
} from "./normalize";
import { redactSensitiveText } from "@/lib/secret-redaction";

type RawObject = Record<string, unknown>;

export interface AlphaVantageTrialOptions {
  apiKey?: string;
  fetcher?: FetchLike;
  cache?: ProviderCache;
  now?: () => Date;
  baseUrl?: string;
  requestSpacingMs?: number;
  clockMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  requestBudget?: ProviderRequestBudget;
  cacheOnly?: boolean;
}

function objectValue(value: unknown): RawObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : null;
}

function alphaPayloadError(payload: unknown): string | null {
  const record = objectValue(payload);
  if (!record) {
    return null;
  }
  const envelopeKeys = new Set(["error message", "note", "information"]);
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
    if (envelopeKeys.has(normalizedKey)) {
      return typeof value === "string" && value.trim()
        ? value.trim()
        : "Alpha Vantage returned an error response."
    }
  }
  return null;
}

function alphaProviderError(
  message: string,
  sensitiveValues: readonly string[] = [],
): ProviderError {
  const safeMessage = redactSensitiveText(message, sensitiveValues).slice(
    0,
    800,
  );
  return {
    code:
      /frequency|rate[\s_-]*limit|requests?\s+per|too many requests|quota|api call volume|request volume|higher api call/i.test(
        safeMessage,
      )
      ? "rate-limit"
      : "upstream",
    message: `Alpha Vantage: ${safeMessage}`,
    retryable: true,
  };
}

function alphaMalformedPayload(message: string): ProviderError {
  return {
    code: "malformed-response",
    message,
    retryable: true,
  };
}

function quotePayloadError(payload: unknown, symbol: string): ProviderError | null {
  const record = objectValue(payload);
  const row = objectValue(record?.["Global Quote"]);
  return row && finiteNumber(row["05. price"]) !== null
    ? null
    : alphaMalformedPayload(
        `Alpha Vantage returned no usable quote for ${symbol}.`,
      );
}

function companyFactsPayloadError(
  payload: unknown,
  symbol: string,
): ProviderError | null {
  const record = objectValue(payload);
  return record &&
    Object.keys(record).length > 0 &&
    typeof record.Symbol === "string" &&
    record.Symbol.trim().length > 0
    ? null
    : alphaMalformedPayload(
        `Alpha Vantage returned no company overview for ${symbol}.`,
      );
}

function newsPayloadError(payload: unknown, symbol: string): ProviderError | null {
  const record = objectValue(payload);
  return record && Array.isArray(record.feed)
    ? null
    : alphaMalformedPayload(
        `Alpha Vantage returned no usable news feed for ${symbol}.`,
      );
}

export class AlphaVantageTrialProvider implements MarketResearchProvider {
  readonly profile = ALPHA_VANTAGE_TRIAL_PROFILE;

  private readonly apiKey: string;
  private readonly fetcher?: FetchLike;
  private readonly cache?: ProviderCache;
  private readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly requestSpacingMs: number;
  private readonly clockMs: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestBudget: ProviderRequestBudget;
  private readonly cacheOnly: boolean;
  private requestQueue: Promise<void> = Promise.resolve();
  private rateLimitCircuitOpen = false;

  constructor(options: AlphaVantageTrialOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.fetcher = options.fetcher;
    this.cache = options.cache;
    this.now = options.now ?? (() => new Date());
    this.baseUrl =
      options.baseUrl?.replace(/\/+$/, "") ?? "https://www.alphavantage.co/query";
    this.requestSpacingMs = Math.max(
      0,
      Math.trunc(options.requestSpacingMs ?? 2_100),
    );
    this.clockMs = options.clockMs ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.requestBudget =
      options.requestBudget ?? new InMemoryProviderRequestBudget();
    this.cacheOnly = options.cacheOnly ?? false;
  }

  private async call<T>(
    operation: string,
    parameters: Record<string, string>,
    cacheTtlMs: number,
    validatePayload: (payload: unknown) => ProviderError | null,
  ): Promise<ProviderResult<T>> {
    if (!this.apiKey) {
      return configurationError(
        this.profile,
        operation,
        "Set an Alpha Vantage API key before requesting market data.",
        this.now(),
      );
    }

    const url = new URL(this.baseUrl);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("apikey", this.apiKey);
    const cacheKey = `alpha-vantage:${operation}:${JSON.stringify(parameters)}`;
    return this.serializeRequest(() =>
      requestJson<T>({
        profile: this.profile,
        operation,
        url,
        cacheKey,
        cacheTtlMs,
        fetcher: this.fetcher,
        cache: this.cache,
        now: this.now,
        beforeNetwork: async () => {
          if (this.rateLimitCircuitOpen) {
            return {
              code: "rate-limit",
              message:
                "Alpha Vantage requests were stopped for this run after a rate-limit response.",
              retryable: true,
            };
          }
          if (this.cacheOnly) {
            return {
              code: "unsupported",
              message:
                "Alpha Vantage cache-only mode found no fresh cached value; no network request was made.",
              retryable: false,
            };
          }
          const reservation = await this.requestBudget.reserve({
            operation,
            cacheKey,
            nowMs: this.clockMs(),
            spacingMs: this.requestSpacingMs,
          });
          if (!reservation.allowed) {
            const retryAt = Number.isFinite(reservation.retryAt)
              ? new Date(reservation.retryAt).toISOString()
              : "the next provider quota window";
            return {
              code: "rate-limit",
              message: `Alpha Vantage request budget exhausted (${reservation.usedCount}/${reservation.limit}); retry after ${retryAt}.`,
              retryable: true,
            };
          }
          if (!Number.isFinite(reservation.scheduledAtMs)) {
            throw new Error("The provider request budget returned an invalid schedule.");
          }
          const waitMs = Math.max(
            0,
            reservation.scheduledAtMs - this.clockMs(),
          );
          if (waitMs > 0) await this.sleep(waitMs);
          return null;
        },
        payloadError: (payload) => {
          const message = alphaPayloadError(payload);
          return message
            ? alphaProviderError(message, [this.apiKey])
            : validatePayload(payload);
        },
        onError: (error) => {
          if (error.code === "rate-limit") {
            this.rateLimitCircuitOpen = true;
          }
        },
      }),
    );
  }

  private async serializeRequest<T>(
    request: () => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> {
    let release!: () => void;
    const previous = this.requestQueue;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await request();
    } finally {
      release();
    }
  }

  async getQuote(symbol: string): Promise<ProviderResult<NormalizedQuote>> {
    const result = await this.call<RawObject>(
      "quote",
      { function: "GLOBAL_QUOTE", symbol },
      30 * 60 * 1_000,
      (payload) => quotePayloadError(payload, symbol),
    );
    if (!result.ok) {
      return result;
    }

    const row = objectValue(result.data["Global Quote"]);
    const price = finiteNumber(row?.["05. price"]);
    if (!row || price === null) {
      return malformedResponse(
        result,
        `Alpha Vantage returned no usable quote for ${symbol}.`,
      );
    }
    const asOf = isoDate(row["07. latest trading day"], this.now());

    return {
      ok: true,
      data: {
        symbol: String(row["01. symbol"] ?? symbol).toUpperCase(),
        price,
        currency: normalizeCurrency(null, symbol),
        exchange: normalizeExchange(null, symbol),
        asOf,
        previousClose: finiteNumber(row["08. previous close"]),
        changePercent: finiteNumber(row["10. change percent"]),
        volume: finiteInteger(row["06. volume"]),
        averageVolume: null,
      },
      meta: { ...result.meta, asOf },
    };
  }

  async getCompanyFacts(
    symbol: string,
  ): Promise<ProviderResult<NormalizedCompanyFacts>> {
    const result = await this.call<RawObject>(
      "company-facts",
      { function: "OVERVIEW", symbol },
      24 * 60 * 60 * 1_000,
      (payload) => companyFactsPayloadError(payload, symbol),
    );
    if (!result.ok) {
      return result;
    }
    if (Object.keys(result.data).length === 0) {
      return malformedResponse(
        result,
        `Alpha Vantage returned no company overview for ${symbol}.`,
      );
    }

    const asOf = isoDate(result.data.LatestQuarter, this.now());
    return {
      ok: true,
      data: {
        symbol: String(result.data.Symbol ?? symbol).toUpperCase(),
        name:
          typeof result.data.Name === "string" ? result.data.Name : null,
        exchange: normalizeExchange(result.data.Exchange, symbol),
        currency: normalizeCurrency(result.data.Currency, symbol),
        assetType: normalizeAssetType(result.data.AssetType),
        country:
          typeof result.data.Country === "string" ? result.data.Country : null,
        sector:
          typeof result.data.Sector === "string" ? result.data.Sector : null,
        industry:
          typeof result.data.Industry === "string" ? result.data.Industry : null,
        asOf,
        marketCap: finiteNumber(result.data.MarketCapitalization),
        sharesOutstanding: finiteNumber(result.data.SharesOutstanding),
        trailingPe: finiteNumber(result.data.PERatio),
        forwardPe: finiteNumber(result.data.ForwardPE),
        priceToBook: finiteNumber(result.data.PriceToBookRatio),
        enterpriseValueToEbitda: finiteNumber(result.data.EVToEBITDA),
        freeCashFlowYield: null,
        returnOnEquity: normalizedRatio(result.data.ReturnOnEquityTTM),
        returnOnAssets: normalizedRatio(result.data.ReturnOnAssetsTTM),
        grossMargin: null,
        operatingMargin: normalizedRatio(result.data.OperatingMarginTTM),
        netMargin: normalizedRatio(result.data.ProfitMargin),
        revenueGrowthYoY: normalizedRatio(
          result.data.QuarterlyRevenueGrowthYOY,
        ),
        earningsGrowthYoY: normalizedRatio(
          result.data.QuarterlyEarningsGrowthYOY,
        ),
        currentRatio: null,
        debtToEquity: null,
        interestCoverage: null,
        analystTargetPrice: finiteNumber(result.data.AnalystTargetPrice),
      },
      meta: { ...result.meta, asOf },
    };
  }

  async getAnalystEstimates(
    symbol: string,
  ): Promise<ProviderResult<NormalizedAnalystEstimates>> {
    return unsupportedResult(
      this.profile,
      "analyst-estimates",
      `Analyst-estimate trend for ${symbol} is disabled in trial mode.`,
      this.now(),
    );
  }

  async getNews(
    symbol: string,
    query: NewsQuery = {},
  ): Promise<ProviderResult<NormalizedNewsItem[]>> {
    const limit = Math.min(50, Math.max(1, Math.trunc(query.limit ?? 20)));
    const parameters: Record<string, string> = {
      function: "NEWS_SENTIMENT",
      tickers: symbol,
      sort: "LATEST",
      limit: String(limit),
    };
    if (query.from) {
      parameters.time_from = query.from;
    }
    if (query.to) {
      parameters.time_to = query.to;
    }

    const result = await this.call<RawObject>(
      "company-news",
      parameters,
      30 * 60 * 1_000,
      (payload) => newsPayloadError(payload, symbol),
    );
    if (!result.ok) {
      return result;
    }
    if (!Array.isArray(result.data.feed)) {
      return malformedResponse(
        result,
        `Alpha Vantage returned no usable news feed for ${symbol}.`,
      );
    }

    const items = result.data.feed
      .map((value): NormalizedNewsItem | null => {
        const row = objectValue(value);
        const title = typeof row?.title === "string" ? row.title : "";
        const url = typeof row?.url === "string" ? row.url : "";
        if (!row || !title || !url) {
          return null;
        }
        const publishedAt = isoDate(row.time_published, this.now());
        const tickerSentiment = Array.isArray(row.ticker_sentiment)
          ? row.ticker_sentiment
              .map(objectValue)
              .find(
                (entry) =>
                  String(entry?.ticker ?? "").toUpperCase() ===
                  symbol.toUpperCase(),
              )
          : null;
        const sentiment =
          clampSentiment(tickerSentiment?.ticker_sentiment_score) ??
          clampSentiment(row.overall_sentiment_score);

        return {
          id: stableNewsId("alpha-vantage", url, publishedAt),
          title,
          url,
          source:
            typeof row.source === "string" ? row.source : null,
          summary:
            typeof row.summary === "string" ? row.summary : null,
          publishedAt,
          symbols: [symbol.toUpperCase()],
          providerSentiment: sentiment,
        };
      })
      .filter((item): item is NormalizedNewsItem => item !== null);
    const asOf =
      items.reduce<string | null>(
        (latest, item) =>
          !latest || Date.parse(item.publishedAt) > Date.parse(latest)
            ? item.publishedAt
            : latest,
        null,
      ) ?? this.now().toISOString();

    return {
      ok: true,
      data: items,
      meta: { ...result.meta, asOf },
    };
  }
}
