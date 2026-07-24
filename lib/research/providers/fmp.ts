import type {
  MarketResearchProvider,
  NewsQuery,
  NormalizedAnalystEstimates,
  NormalizedCompanyFacts,
  NormalizedEstimate,
  NormalizedNewsItem,
  NormalizedQuote,
  ProviderRequestMetadata,
  ProviderResult,
} from "../types";
import { FMP_FULL_PROFILE } from "./contracts";
import {
  configurationError,
  malformedResponse,
  requestJson,
  type FetchLike,
  type ProviderCache,
} from "./http";
import {
  finiteInteger,
  finiteNumber,
  isoDate,
  normalizeAssetType,
  normalizeCurrency,
  normalizeExchange,
  normalizedRatio,
  stableNewsId,
} from "./normalize";

type RawObject = Record<string, unknown>;

export interface FmpFullOptions {
  apiKey?: string;
  fetcher?: FetchLike;
  cache?: ProviderCache;
  now?: () => Date;
  baseUrl?: string;
}

function objectValue(value: unknown): RawObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : null;
}

function firstObject(value: unknown): RawObject | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return objectValue(value[0]);
}

function fmpPayloadError(payload: unknown): string | null {
  const record = objectValue(payload);
  if (!record) {
    return null;
  }
  for (const key of ["Error Message", "error", "message"]) {
    if (typeof record[key] === "string") {
      return record[key] as string;
    }
  }
  return null;
}

function fmpFailure<T>(
  source: ProviderResult<unknown>,
  message: string,
): ProviderResult<T> {
  return {
    ok: false,
    error: {
      code: /limit|too many|quota/i.test(message) ? "rate-limit" : "upstream",
      message: `Financial Modeling Prep: ${message}`,
      retryable: true,
    },
    meta: source.meta,
  };
}

function mergeMetadata(
  primary: ProviderRequestMetadata,
  others: readonly ProviderResult<unknown>[],
): ProviderRequestMetadata {
  const warnings = [...primary.warnings];
  let cache = primary.cache;
  for (const result of others) {
    warnings.push(...result.meta.warnings);
    if (!result.ok) {
      warnings.push(`${result.meta.operation}: ${result.error.message}`);
    }
    if (result.meta.cache.state === "stale-fallback") {
      cache = result.meta.cache;
    }
  }
  return { ...primary, cache, warnings: [...new Set(warnings)] };
}

export class FmpFullProvider implements MarketResearchProvider {
  readonly profile = FMP_FULL_PROFILE;

  private readonly apiKey: string;
  private readonly fetcher?: FetchLike;
  private readonly cache?: ProviderCache;
  private readonly now: () => Date;
  private readonly baseUrl: string;

  constructor(options: FmpFullOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.fetcher = options.fetcher;
    this.cache = options.cache;
    this.now = options.now ?? (() => new Date());
    this.baseUrl =
      options.baseUrl?.replace(/\/+$/, "") ??
      "https://financialmodelingprep.com/stable";
  }

  private async call<T>(
    operation: string,
    path: string,
    parameters: Record<string, string>,
    cacheTtlMs: number,
  ): Promise<ProviderResult<T>> {
    if (!this.apiKey) {
      return configurationError(
        this.profile,
        operation,
        "Set a Financial Modeling Prep API key before requesting market data.",
        this.now(),
      );
    }

    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("apikey", this.apiKey);
    const cacheKey = `fmp:${operation}:${JSON.stringify(parameters)}`;
    const result = await requestJson<T>({
      profile: this.profile,
      operation,
      url,
      cacheKey,
      cacheTtlMs,
      fetcher: this.fetcher,
      cache: this.cache,
      now: this.now,
    });
    if (result.ok) {
      const providerError = fmpPayloadError(result.data);
      if (providerError) {
        return fmpFailure(result, providerError);
      }
    }
    return result;
  }

  async getQuote(symbol: string): Promise<ProviderResult<NormalizedQuote>> {
    const result = await this.call<unknown>(
      "quote",
      "quote",
      { symbol },
      60 * 1_000,
    );
    if (!result.ok) {
      return result;
    }

    const row = firstObject(result.data);
    const price = finiteNumber(row?.price);
    if (!row || price === null) {
      return malformedResponse(
        result,
        `Financial Modeling Prep returned no usable quote for ${symbol}.`,
      );
    }
    const asOf = isoDate(row.timestamp, this.now());

    return {
      ok: true,
      data: {
        symbol: String(row.symbol ?? symbol).toUpperCase(),
        price,
        currency: normalizeCurrency(row.currency, symbol),
        exchange: normalizeExchange(
          row.exchangeShortName ?? row.exchange,
          symbol,
        ),
        asOf,
        previousClose: finiteNumber(row.previousClose),
        changePercent: finiteNumber(
          row.changePercentage ?? row.changesPercentage,
        ),
        volume: finiteInteger(row.volume),
        averageVolume: finiteInteger(row.avgVolume),
      },
      meta: { ...result.meta, asOf },
    };
  }

  async getCompanyFacts(
    symbol: string,
  ): Promise<ProviderResult<NormalizedCompanyFacts>> {
    const [profileResult, ratiosResult, metricsResult] = await Promise.all([
      this.call<unknown>(
        "company-profile",
        "profile",
        { symbol },
        24 * 60 * 60 * 1_000,
      ),
      this.call<unknown>(
        "ratios-ttm",
        "ratios-ttm",
        { symbol },
        6 * 60 * 60 * 1_000,
      ),
      this.call<unknown>(
        "key-metrics-ttm",
        "key-metrics-ttm",
        { symbol },
        6 * 60 * 60 * 1_000,
      ),
    ]);
    if (!profileResult.ok) {
      return profileResult;
    }

    const profile = firstObject(profileResult.data);
    if (!profile) {
      return malformedResponse(
        profileResult,
        `Financial Modeling Prep returned no company profile for ${symbol}.`,
      );
    }
    const ratios = ratiosResult.ok ? (firstObject(ratiosResult.data) ?? {}) : {};
    const metrics = metricsResult.ok
      ? (firstObject(metricsResult.data) ?? {})
      : {};
    const asOf = isoDate(
      profile.lastUpdated ?? ratios.date ?? metrics.date,
      this.now(),
    );
    const meta = mergeMetadata(profileResult.meta, [
      ratiosResult,
      metricsResult,
    ]);

    return {
      ok: true,
      data: {
        symbol: String(profile.symbol ?? symbol).toUpperCase(),
        name:
          typeof profile.companyName === "string"
            ? profile.companyName
            : null,
        exchange: normalizeExchange(
          profile.exchangeShortName ?? profile.exchange,
          symbol,
        ),
        currency: normalizeCurrency(profile.currency, symbol),
        assetType: normalizeAssetType(
          profile.isEtf ? "etf" : profile.isFund ? "fund" : "common-stock",
          profile.isEtf === true,
          profile.isFund === true,
        ),
        country:
          typeof profile.country === "string" ? profile.country : null,
        sector:
          typeof profile.sector === "string" ? profile.sector : null,
        industry:
          typeof profile.industry === "string" ? profile.industry : null,
        asOf,
        marketCap: finiteNumber(profile.marketCap),
        sharesOutstanding: finiteNumber(
          profile.sharesOutstanding ?? metrics.numberOfSharesTTM,
        ),
        trailingPe: finiteNumber(
          ratios.priceToEarningsRatioTTM ?? ratios.priceEarningsRatioTTM,
        ),
        forwardPe: finiteNumber(ratios.forwardPriceToEarningsGrowthRatioTTM),
        priceToBook: finiteNumber(ratios.priceToBookRatioTTM),
        enterpriseValueToEbitda: finiteNumber(
          ratios.enterpriseValueMultipleTTM ??
            metrics.enterpriseValueOverEBITDATTM,
        ),
        freeCashFlowYield: finiteNumber(metrics.freeCashFlowYieldTTM),
        returnOnEquity: normalizedRatio(ratios.returnOnEquityTTM),
        returnOnAssets: normalizedRatio(ratios.returnOnAssetsTTM),
        grossMargin: normalizedRatio(ratios.grossProfitMarginTTM),
        operatingMargin: normalizedRatio(ratios.operatingProfitMarginTTM),
        netMargin: normalizedRatio(ratios.netProfitMarginTTM),
        revenueGrowthYoY: normalizedRatio(metrics.revenueGrowthTTM),
        earningsGrowthYoY: normalizedRatio(metrics.netIncomeGrowthTTM),
        currentRatio: finiteNumber(ratios.currentRatioTTM),
        debtToEquity: finiteNumber(ratios.debtToEquityRatioTTM),
        interestCoverage: finiteNumber(
          ratios.interestCoverageRatioTTM ?? metrics.interestCoverageTTM,
        ),
        analystTargetPrice: null,
      },
      meta: { ...meta, asOf },
    };
  }

  async getAnalystEstimates(
    symbol: string,
  ): Promise<ProviderResult<NormalizedAnalystEstimates>> {
    const result = await this.call<unknown>(
      "analyst-estimates",
      "analyst-estimates",
      { symbol, period: "annual", limit: "4" },
      6 * 60 * 60 * 1_000,
    );
    if (!result.ok) {
      return result;
    }
    if (!Array.isArray(result.data)) {
      return malformedResponse(
        result,
        `Financial Modeling Prep returned no analyst estimates for ${symbol}.`,
      );
    }

    const estimates = result.data
      .map((value): NormalizedEstimate | null => {
        const row = objectValue(value);
        if (!row || typeof row.date !== "string") {
          return null;
        }
        return {
          periodEnd: isoDate(row.date, this.now()),
          revenueAverage: finiteNumber(
            row.revenueAvg ?? row.estimatedRevenueAvg,
          ),
          epsAverage: finiteNumber(row.epsAvg ?? row.estimatedEpsAvg),
          revenueAnalystCount: finiteInteger(
            row.numAnalystsRevenue ?? row.numberAnalystsEstimatedRevenue,
          ),
          epsAnalystCount: finiteInteger(
            row.numAnalystsEps ?? row.numberAnalystsEstimatedEps,
          ),
        };
      })
      .filter((estimate): estimate is NormalizedEstimate => estimate !== null);
    const asOf = result.meta.receivedAt ?? this.now().toISOString();

    return {
      ok: true,
      data: { symbol: symbol.toUpperCase(), asOf, estimates },
      meta: { ...result.meta, asOf },
    };
  }

  async getNews(
    symbol: string,
    query: NewsQuery = {},
  ): Promise<ProviderResult<NormalizedNewsItem[]>> {
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)));
    const parameters: Record<string, string> = {
      symbols: symbol,
      page: "0",
      limit: String(limit),
    };
    if (query.from) {
      parameters.from = query.from;
    }
    if (query.to) {
      parameters.to = query.to;
    }
    const result = await this.call<unknown>(
      "company-news",
      "news/stock",
      parameters,
      15 * 60 * 1_000,
    );
    if (!result.ok) {
      return result;
    }
    if (!Array.isArray(result.data)) {
      return malformedResponse(
        result,
        `Financial Modeling Prep returned no usable news feed for ${symbol}.`,
      );
    }

    const items = result.data
      .map((value): NormalizedNewsItem | null => {
        const row = objectValue(value);
        const title = typeof row?.title === "string" ? row.title : "";
        const url =
          typeof row?.url === "string"
            ? row.url
            : typeof row?.link === "string"
              ? row.link
              : "";
        if (!row || !title || !url) {
          return null;
        }
        const publishedAt = isoDate(
          row.publishedDate ?? row.publishedAt,
          this.now(),
        );
        const rawSymbols = Array.isArray(row.symbols)
          ? row.symbols
          : [row.symbol ?? symbol];
        return {
          id: stableNewsId("fmp", url, publishedAt),
          title,
          url,
          source:
            typeof row.site === "string"
              ? row.site
              : typeof row.publisher === "string"
                ? row.publisher
                : null,
          summary:
            typeof row.text === "string"
              ? row.text
              : typeof row.summary === "string"
                ? row.summary
                : null,
          publishedAt,
          symbols: rawSymbols.map((item) => String(item).toUpperCase()),
          providerSentiment: null,
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
