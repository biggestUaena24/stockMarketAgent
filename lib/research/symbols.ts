import { quoteKeyForHolding } from "@/lib/portfolio-market-quote";

export function researchSymbolForHolding(input: {
  symbol: string;
  exchange: string;
}): string {
  return quoteKeyForHolding(input);
}

export function symbolForProvider(canonical: string, provider: string): string {
  const symbol = canonical.trim().toUpperCase();
  if (provider === "alpha-vantage") {
    if (symbol.endsWith(".TO")) return `${symbol.slice(0, -3)}.TRT`;
    if (symbol.endsWith(".V")) return `${symbol.slice(0, -2)}.TRV`;
  }
  return symbol;
}
