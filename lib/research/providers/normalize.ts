import type {
  NormalizedAssetType,
  SupportedCurrency,
  SupportedExchange,
} from "../types";

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "None") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replaceAll(",", "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function finiteInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function normalizedRatio(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : parsed;
}

export function clampSentiment(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.min(1, Math.max(-1, parsed));
}

export function normalizeCurrency(
  value: unknown,
  symbol?: string,
): SupportedCurrency | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "CAD" || normalized === "USD") {
    return normalized;
  }
  const ticker = symbol?.toUpperCase() ?? "";
  return ticker.endsWith(".TO") ||
    ticker.endsWith(".V") ||
    ticker.endsWith(".TRT") ||
    ticker.endsWith(".TRV")
    ? "CAD"
    : ticker
      ? "USD"
      : null;
}

export function normalizeExchange(
  value: unknown,
  symbol?: string,
): SupportedExchange {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replaceAll(" ", "_");

  if (
    normalized === "TSX" ||
    normalized === "TORONTO_STOCK_EXCHANGE" ||
    normalized === "XTSE"
  ) {
    return "TSX";
  }
  if (
    normalized === "TSXV" ||
    normalized === "TSX_VENTURE" ||
    normalized === "XTSX"
  ) {
    return "TSXV";
  }
  if (normalized === "NASDAQ" || normalized.startsWith("NASDAQ_")) {
    return "NASDAQ";
  }
  if (normalized === "NYSE") {
    return "NYSE";
  }
  if (
    normalized === "AMEX" ||
    normalized === "NYSE_AMERICAN" ||
    normalized === "NYSEAMERICAN"
  ) {
    return "NYSE_AMERICAN";
  }
  if (normalized.includes("OTC")) {
    return "OTC";
  }
  if (normalized === "CSE" || normalized === "XCNQ") {
    return "CSE";
  }

  const ticker = symbol?.toUpperCase() ?? "";
  if (ticker.endsWith(".TO") || ticker.endsWith(".TRT")) {
    return "TSX";
  }
  if (ticker.endsWith(".V") || ticker.endsWith(".TRV")) {
    return "TSXV";
  }
  return "UNKNOWN";
}

export function normalizeAssetType(
  value: unknown,
  isEtf = false,
  isFund = false,
): NormalizedAssetType {
  if (isEtf) {
    return "etf";
  }
  if (isFund) {
    return "fund";
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("common") || normalized === "stock") {
    return "common-stock";
  }
  if (normalized.includes("exchange traded") || normalized === "etf") {
    return "etf";
  }
  if (normalized.includes("fund")) {
    return "fund";
  }
  if (normalized.includes("option")) {
    return "option";
  }
  if (normalized.includes("crypto")) {
    return "crypto";
  }
  return "other";
}

export function isoDate(value: unknown, fallback: Date): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(millis).toISOString();
  }

  const raw = String(value ?? "").trim();
  if (/^\d{8}T\d{6}$/.test(raw)) {
    return new Date(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(
        9,
        11,
      )}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`,
    ).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00.000Z`;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback.toISOString();
}

export function stableNewsId(
  provider: string,
  url: string,
  publishedAt: string,
): string {
  let hash = 2166136261;
  const input = `${provider}|${url}|${publishedAt}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${provider}-${(hash >>> 0).toString(16)}`;
}
