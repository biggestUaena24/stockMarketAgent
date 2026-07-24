import type {
  GateAssessment,
  GateReason,
  NormalizedAssetType,
  SupportedCurrency,
  SupportedExchange,
} from "./types";

export type ResearchStrategy = "long-term" | "short" | "day-trade";

export interface SafetyUniverseSecurity {
  symbol: string;
  exchange: SupportedExchange;
  currency: SupportedCurrency | null;
  assetType: NormalizedAssetType;
  price: number | null;
  marketCap: number | null;
  fundAssets: number | null;
  averageDailyDollarVolume: number | null;
  isBroadMarketEtf: boolean;
  isLeveraged: boolean;
  isInverse: boolean;
  isHalted: boolean;
  isDelisted: boolean;
  isWealthsimpleEligible: boolean;
}

export interface SafetyUniversePolicy {
  allowedExchanges: readonly SupportedExchange[];
  allowedCurrencies: readonly SupportedCurrency[];
  minimumSharePrice: number;
  minimumStockMarketCap: number;
  minimumEtfAssets: number;
  minimumAverageDailyDollarVolume: number;
}

export const DEFAULT_SAFETY_UNIVERSE_POLICY = {
  allowedExchanges: ["TSX", "NYSE", "NASDAQ"],
  allowedCurrencies: ["CAD", "USD"],
  minimumSharePrice: 5,
  minimumStockMarketCap: 10_000_000_000,
  minimumEtfAssets: 500_000_000,
  minimumAverageDailyDollarVolume: 5_000_000,
} as const satisfies SafetyUniversePolicy;

export interface SafetyUniverseAssessment extends GateAssessment {
  eligible: boolean;
  symbol: string;
}

export function assessSafetyUniverse(
  security: SafetyUniverseSecurity,
  strategy: ResearchStrategy = "long-term",
  policy: SafetyUniversePolicy = DEFAULT_SAFETY_UNIVERSE_POLICY,
): SafetyUniverseAssessment {
  const reasons: GateReason[] = [];

  if (strategy === "short") {
    reasons.push({
      code: "short-strategy-excluded",
      message: "Short-selling suggestions are outside the safety universe.",
    });
  }
  if (strategy === "day-trade") {
    reasons.push({
      code: "day-trading-excluded",
      message: "Day-trading suggestions are outside the safety universe.",
    });
  }
  if (!policy.allowedExchanges.includes(security.exchange)) {
    reasons.push({
      code:
        security.exchange === "OTC"
          ? "otc-excluded"
          : "exchange-not-supported",
      message: `${security.exchange} is outside the supported TSX/NYSE/Nasdaq universe.`,
    });
  }
  if (
    security.currency === null ||
    !policy.allowedCurrencies.includes(security.currency)
  ) {
    reasons.push({
      code: "currency-not-supported",
      message: "Only CAD and USD securities are supported.",
    });
  }
  if (
    security.assetType !== "common-stock" &&
    security.assetType !== "etf"
  ) {
    reasons.push({
      code: `${security.assetType}-excluded`,
      message: "Only common stocks and broad-market ETFs are supported.",
    });
  }
  if (security.assetType === "etf" && !security.isBroadMarketEtf) {
    reasons.push({
      code: "non-broad-etf-excluded",
      message: "Only broad-market ETFs are supported.",
    });
  }
  if (security.isLeveraged || security.isInverse) {
    reasons.push({
      code: "leveraged-inverse-excluded",
      message: "Leveraged and inverse funds are excluded.",
    });
  }
  if (security.price === null) {
    reasons.push({
      code: "price-missing",
      message: "A current share price is required to establish eligibility.",
    });
  } else if (security.price < policy.minimumSharePrice) {
    reasons.push({
      code: "penny-stock-excluded",
      message: `Securities below ${policy.minimumSharePrice.toFixed(2)} are excluded.`,
    });
  }

  if (security.assetType === "common-stock") {
    if (security.marketCap === null) {
      reasons.push({
        code: "market-cap-missing",
        message: "Market capitalization is required for a stock.",
      });
    } else if (security.marketCap < policy.minimumStockMarketCap) {
      reasons.push({
        code: "microcap-excluded",
        message: "The stock does not meet the configured large-cap threshold.",
      });
    }
  }
  if (security.assetType === "etf") {
    if (security.fundAssets === null) {
      reasons.push({
        code: "fund-assets-missing",
        message: "Fund assets are required for an ETF.",
      });
    } else if (security.fundAssets < policy.minimumEtfAssets) {
      reasons.push({
        code: "small-fund-excluded",
        message: "The ETF does not meet the configured fund-size threshold.",
      });
    }
  }

  if (security.averageDailyDollarVolume === null) {
    reasons.push({
      code: "liquidity-missing",
      message: "Average daily dollar volume is required.",
    });
  } else if (
    security.averageDailyDollarVolume <
    policy.minimumAverageDailyDollarVolume
  ) {
    reasons.push({
      code: "illiquid-excluded",
      message: "The security does not meet the configured liquidity threshold.",
    });
  }
  if (security.isHalted) {
    reasons.push({
      code: "halted-excluded",
      message: "Halted securities are excluded.",
    });
  }
  if (security.isDelisted) {
    reasons.push({
      code: "delisted-excluded",
      message: "Delisted securities are excluded.",
    });
  }
  if (!security.isWealthsimpleEligible) {
    reasons.push({
      code: "broker-ineligible",
      message: "The security is not currently eligible at Wealthsimple.",
    });
  }

  return {
    status: reasons.length > 0 ? "block" : "pass",
    reasons,
    eligible: reasons.length === 0,
    symbol: security.symbol.toUpperCase(),
  };
}
