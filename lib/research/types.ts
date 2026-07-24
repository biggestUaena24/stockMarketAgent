export type ProviderId = "alpha-vantage" | "fmp";

export type ProviderMode = "trial" | "full";

export type QuoteFreshness =
  | "end-of-day"
  | "delayed"
  | "provider-claimed-real-time";

export type CacheState =
  | "not-configured"
  | "miss"
  | "hit"
  | "stale-fallback";

export interface CacheMetadata {
  state: CacheState;
  key?: string;
  storedAt?: string;
  expiresAt?: string;
}

export interface ProviderCapabilities {
  quoteFreshness: QuoteFreshness;
  canadianEquities: boolean;
  usEquities: boolean;
  fundamentals: boolean;
  analystEstimates: boolean;
  companyNews: boolean;
  providerSentiment: boolean;
}

export interface ResearchProviderProfile {
  id: ProviderId;
  mode: ProviderMode;
  displayName: string;
  isFullDataProvider: boolean;
  maxResearchSymbols: number | null;
  documentedDailyRequestLimit: number | null;
  capabilities: ProviderCapabilities;
  warnings: readonly string[];
}

export interface ProviderRequestMetadata {
  provider: ProviderId;
  mode: ProviderMode;
  operation: string;
  endpoint: string;
  requestedAt: string;
  receivedAt?: string;
  asOf?: string;
  cache: CacheMetadata;
  warnings: string[];
}

export type ProviderErrorCode =
  | "configuration"
  | "invalid-symbol"
  | "authorization"
  | "rate-limit"
  | "not-found"
  | "unsupported"
  | "timeout"
  | "network"
  | "upstream"
  | "malformed-response";

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
}

export type ProviderResult<T> =
  | {
      ok: true;
      data: T;
      meta: ProviderRequestMetadata;
    }
  | {
      ok: false;
      error: ProviderError;
      meta: ProviderRequestMetadata;
    };

export type SupportedCurrency = "CAD" | "USD";

export type SupportedExchange =
  | "TSX"
  | "TSXV"
  | "NYSE"
  | "NASDAQ"
  | "NYSE_AMERICAN"
  | "OTC"
  | "CSE"
  | "UNKNOWN";

export type NormalizedAssetType =
  | "common-stock"
  | "etf"
  | "fund"
  | "option"
  | "crypto"
  | "other";

export interface NormalizedQuote {
  symbol: string;
  price: number;
  currency: SupportedCurrency | null;
  exchange: SupportedExchange;
  asOf: string;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | null;
  averageVolume: number | null;
}

export interface NormalizedCompanyFacts {
  symbol: string;
  name: string | null;
  exchange: SupportedExchange;
  currency: SupportedCurrency | null;
  assetType: NormalizedAssetType;
  country: string | null;
  sector: string | null;
  industry: string | null;
  asOf: string;
  marketCap: number | null;
  sharesOutstanding: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  enterpriseValueToEbitda: number | null;
  freeCashFlowYield: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  revenueGrowthYoY: number | null;
  earningsGrowthYoY: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  analystTargetPrice: number | null;
}

export interface NormalizedEstimate {
  periodEnd: string;
  revenueAverage: number | null;
  epsAverage: number | null;
  revenueAnalystCount: number | null;
  epsAnalystCount: number | null;
}

export interface NormalizedAnalystEstimates {
  symbol: string;
  asOf: string;
  estimates: NormalizedEstimate[];
}

export interface NormalizedNewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  summary: string | null;
  publishedAt: string;
  symbols: string[];
  providerSentiment: number | null;
}

export interface NewsQuery {
  limit?: number;
  from?: string;
  to?: string;
}

export interface MarketResearchProvider {
  readonly profile: ResearchProviderProfile;

  getQuote(symbol: string): Promise<ProviderResult<NormalizedQuote>>;

  getCompanyFacts(
    symbol: string,
  ): Promise<ProviderResult<NormalizedCompanyFacts>>;

  getAnalystEstimates(
    symbol: string,
  ): Promise<ProviderResult<NormalizedAnalystEstimates>>;

  getNews(
    symbol: string,
    query?: NewsQuery,
  ): Promise<ProviderResult<NormalizedNewsItem[]>>;
}

export type GateStatus = "pass" | "caution" | "block";

export interface GateReason {
  code: string;
  message: string;
}

export interface GateAssessment {
  status: GateStatus;
  reasons: GateReason[];
}
