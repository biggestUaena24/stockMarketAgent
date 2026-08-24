export type PortfolioMarkFreshness = "fresh" | "stale" | "ledger-fallback";
export type PortfolioMarkTimePrecision =
  | "market-date"
  | "timestamp"
  | "ledger-time";

export type SavedProviderQuote = {
  canonicalSymbol: string;
  priceNative: number;
  currency: "CAD" | "USD";
  asOf: string;
  savedAt: string;
  provider: string;
  sourceUrl: string;
  cacheState: string;
};

const PRICE_FACT =
  /^The recorded provider price is ([+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?) (CAD|USD)\.$/i;

export function parseSavedProviderQuote(input: {
  canonicalSymbol: string;
  factsJson: string;
  marketDataTime: string | null;
  createdAt: string;
  provider: string;
  sourceUrl: string;
  freshness: string;
}): SavedProviderQuote | null {
  if (!input.marketDataTime || !validTimestamp(input.marketDataTime)) {
    return null;
  }
  const facts = parseStringArray(input.factsJson);
  const match = facts
    .map((fact) => PRICE_FACT.exec(fact))
    .find((candidate) => candidate !== null);
  if (!match) return null;

  const priceNative = Number(match[1]);
  const currency = match[2]?.toUpperCase();
  if (
    !Number.isFinite(priceNative) ||
    priceNative <= 0 ||
    (currency !== "CAD" && currency !== "USD")
  ) {
    return null;
  }

  return {
    canonicalSymbol: normalizeCanonicalSymbol(input.canonicalSymbol),
    priceNative,
    currency,
    asOf: new Date(input.marketDataTime).toISOString(),
    savedAt: validTimestamp(input.createdAt)
      ? new Date(input.createdAt).toISOString()
      : new Date(input.marketDataTime).toISOString(),
    provider: input.provider.trim() || "Market-data provider",
    sourceUrl: input.sourceUrl.trim(),
    cacheState: input.freshness,
  };
}

export function quoteKeyForHolding(input: {
  symbol: string;
  exchange: string;
}): string {
  const symbol = normalizeCanonicalSymbol(input.symbol);
  if (input.exchange === "TSX") {
    return symbol.endsWith(".TO") ? symbol : `${symbol}.TO`;
  }
  if (input.exchange === "TSXV") {
    return symbol.endsWith(".V") ? symbol : `${symbol}.V`;
  }
  return symbol;
}

export function providerDisplayName(provider: string): string {
  if (provider === "alpha-vantage") return "Alpha Vantage";
  if (provider === "fmp") return "Financial Modeling Prep";
  return provider.trim() || "Market-data provider";
}

export function assessPortfolioQuoteFreshness(
  quote: SavedProviderQuote,
  now: Date,
): { freshness: "fresh" | "stale"; ageMinutes: number } {
  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(quote.asOf)) / 60_000),
  );
  const futureDated = Date.parse(quote.asOf) > now.getTime() + 5 * 60_000;
  const maximumAgeMinutes =
    quote.provider === "alpha-vantage" ? 36 * 60 : 20;
  return {
    freshness:
      futureDated ||
      quote.cacheState === "stale-fallback" ||
      ageMinutes > maximumAgeMinutes
        ? "stale"
        : "fresh",
    ageMinutes,
  };
}

function normalizeCanonicalSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
