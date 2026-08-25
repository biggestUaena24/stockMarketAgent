import type {
  MarketResearchProvider,
  ProviderResult,
  ResearchProviderProfile,
} from "../types";

export const ALPHA_VANTAGE_TRIAL_PROFILE = {
  id: "alpha-vantage",
  mode: "trial",
  displayName: "Alpha Vantage trial",
  isFullDataProvider: false,
  maxResearchSymbols: 4,
  documentedDailyRequestLimit: 25,
  capabilities: {
    quoteFreshness: "end-of-day",
    canadianEquities: true,
    usEquities: true,
    fundamentals: true,
    analystEstimates: false,
    companyNews: true,
    providerSentiment: true,
  },
  warnings: [
    "Trial quotes must be treated as end-of-day research data.",
    "Trial runs research at most four unique holdings and watchlist symbols, with holdings first.",
    "Coverage and freshness must be verified for every Canadian symbol.",
  ],
} as const satisfies ResearchProviderProfile;

export const FMP_FULL_PROFILE = {
  id: "fmp",
  mode: "full",
  displayName: "Financial Modeling Prep full",
  isFullDataProvider: true,
  maxResearchSymbols: null,
  documentedDailyRequestLimit: null,
  capabilities: {
    quoteFreshness: "provider-claimed-real-time",
    canadianEquities: true,
    usEquities: true,
    fundamentals: true,
    analystEstimates: true,
    companyNews: true,
    providerSentiment: false,
  },
  warnings: [
    "Canadian quote entitlement and consolidation must be verified with the provider.",
    "Provider news does not constitute an independent social-sentiment feed.",
  ],
} as const satisfies ResearchProviderProfile;

export interface ResearchSelection {
  requested: string[];
  accepted: string[];
  rejected: string[];
  withinLimit: boolean;
  limit: number | null;
  reasons: string[];
}

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

export function normalizeResearchSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  return SYMBOL_PATTERN.test(normalized) ? normalized : null;
}

export function selectResearchSymbols(
  symbols: readonly string[],
  profile: ResearchProviderProfile,
): ResearchSelection {
  const requested: string[] = [];
  const invalid: string[] = [];

  for (const symbol of symbols) {
    const normalized = normalizeResearchSymbol(symbol);
    if (!normalized) {
      invalid.push(symbol);
      continue;
    }
    if (!requested.includes(normalized)) {
      requested.push(normalized);
    }
  }

  const limit = profile.maxResearchSymbols;
  const accepted = limit === null ? requested : requested.slice(0, limit);
  const rejected = [
    ...invalid,
    ...(limit === null ? [] : requested.slice(limit)),
  ];
  const reasons: string[] = [];

  if (invalid.length > 0) {
    reasons.push(`${invalid.length} invalid symbol(s) were rejected.`);
  }
  if (limit !== null && requested.length > limit) {
    reasons.push(
      `${profile.displayName} allows at most ${limit} researched symbols per run.`,
    );
  }

  return {
    requested,
    accepted,
    rejected,
    withinLimit: rejected.length === 0,
    limit,
    reasons,
  };
}

export function unsupportedResult<T>(
  profile: ResearchProviderProfile,
  operation: string,
  message: string,
  now = new Date(),
): ProviderResult<T> {
  return {
    ok: false,
    error: {
      code: "unsupported",
      message,
      retryable: false,
    },
    meta: {
      provider: profile.id,
      mode: profile.mode,
      operation,
      endpoint: "",
      requestedAt: now.toISOString(),
      cache: { state: "not-configured" },
      warnings: [...profile.warnings],
    },
  };
}

export type ProviderFactory = (
  options: Record<string, unknown>,
) => MarketResearchProvider;
