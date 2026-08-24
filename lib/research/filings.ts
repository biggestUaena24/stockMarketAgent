export type FilingReference = {
  sourceUrl: string;
  fact: string;
  provider: "SEDAR+" | "SEC EDGAR";
};

export function authoritativeFilingReference(
  exchange: string,
  symbol: string,
): FilingReference {
  const normalizedExchange = exchange.trim().toUpperCase();
  if (normalizedExchange === "TSX" || normalizedExchange === "TSXV") {
    return {
      sourceUrl: "https://www.sedarplus.ca/",
      fact: "Use SEDAR+ as the authoritative Canadian filing reference.",
      provider: "SEDAR+",
    };
  }

  const baseSymbol = symbol
    .trim()
    .toUpperCase()
    .replace(/\.(TO|TRT|V|TRV)$/i, "");
  return {
    sourceUrl: `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(baseSymbol)}`,
    fact: "Use SEC EDGAR as the authoritative United States filing reference.",
    provider: "SEC EDGAR",
  };
}
