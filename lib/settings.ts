import { eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { ownerSettings } from "@/db/schema";
import { ApiError, clampNumber } from "./http";

export type ProviderMode = "trial" | "full";

export type OwnerSettings = {
  ownerEmail: string;
  onboardingComplete: boolean;
  horizonYears: number;
  lossTolerancePct: number;
  emergencyFundConfirmed: boolean;
  usdAccountEnabled: boolean;
  tfsaRoomEstimateCad: number;
  tfsaAnnualLimitCad: number;
  availableCashCad: number;
  exclusions: string[];
  watchlist: string[];
  etfCoreTargetPct: number;
  individualStocksMaxPct: number;
  singleStockMaxPct: number;
  providerMode: ProviderMode;
  quoteEntitlementVerified: boolean;
  liveLabelsAcknowledged: boolean;
  ledgerReconciledAt: string | null;
  paperTrialStartedAt: string | null;
  updatedAt: string;
};

export async function getOrCreateSettings(
  ownerEmail: string,
): Promise<OwnerSettings> {
  const db = await getReadyDb();
  const existing = await db
    .select()
    .from(ownerSettings)
    .where(eq(ownerSettings.ownerEmail, ownerEmail))
    .limit(1);
  if (existing[0]) return mapSettings(existing[0]);

  await db.insert(ownerSettings).values({ ownerEmail }).onConflictDoNothing();
  const created = await db
    .select()
    .from(ownerSettings)
    .where(eq(ownerSettings.ownerEmail, ownerEmail))
    .limit(1);
  if (!created[0]) throw new Error("Unable to initialize owner settings.");
  return mapSettings(created[0]);
}

export async function updateOwnerSettings(
  ownerEmail: string,
  payload: Record<string, unknown>,
): Promise<OwnerSettings> {
  const current = await getOrCreateSettings(ownerEmail);
  const now = new Date().toISOString();
  const values: Partial<typeof ownerSettings.$inferInsert> = {
    updatedAt: now,
  };

  if ("horizonYears" in payload) {
    values.horizonYears = Math.round(
      clampNumber(payload.horizonYears, 1, 50, "horizonYears"),
    );
  }
  if ("lossTolerancePct" in payload) {
    values.lossTolerancePct = clampNumber(
      payload.lossTolerancePct,
      1,
      80,
      "lossTolerancePct",
    );
  }
  if ("tfsaRoomEstimateCad" in payload) {
    values.tfsaRoomEstimateCad = clampNumber(
      payload.tfsaRoomEstimateCad,
      0,
      5_000_000,
      "tfsaRoomEstimateCad",
    );
  }
  if ("availableCashCad" in payload) {
    values.availableCashCad = clampNumber(
      payload.availableCashCad,
      0,
      100_000_000,
      "availableCashCad",
    );
  }
  if ("etfCoreTargetPct" in payload) {
    values.etfCoreTargetPct = clampNumber(
      payload.etfCoreTargetPct,
      50,
      100,
      "etfCoreTargetPct",
    );
  }
  if ("individualStocksMaxPct" in payload) {
    values.individualStocksMaxPct = clampNumber(
      payload.individualStocksMaxPct,
      0,
      50,
      "individualStocksMaxPct",
    );
  }
  if ("singleStockMaxPct" in payload) {
    values.singleStockMaxPct = clampNumber(
      payload.singleStockMaxPct,
      0,
      20,
      "singleStockMaxPct",
    );
  }

  for (const key of [
    "emergencyFundConfirmed",
    "usdAccountEnabled",
    "quoteEntitlementVerified",
    "liveLabelsAcknowledged",
    "onboardingComplete",
  ] as const) {
    if (key in payload) {
      if (typeof payload[key] !== "boolean") {
        throw new ApiError(`${key} must be true or false.`);
      }
      values[key] = payload[key] as never;
    }
  }

  if ("providerMode" in payload) {
    if (payload.providerMode !== "trial" && payload.providerMode !== "full") {
      throw new ApiError("providerMode must be trial or full.");
    }
    values.providerMode = payload.providerMode;
  }

  if ("exclusions" in payload) {
    values.exclusionsJson = JSON.stringify(
      normalizeStringList(payload.exclusions, "exclusions", 30),
    );
  }
  if ("watchlist" in payload) {
    values.watchlistJson = JSON.stringify(
      normalizeStringList(payload.watchlist, "watchlist", 25).map((item) =>
        item.toUpperCase(),
      ),
    );
  }
  if ("ledgerReconciledAt" in payload) {
    values.ledgerReconciledAt = optionalIsoDate(
      payload.ledgerReconciledAt,
      "ledgerReconciledAt",
    );
  }
  if ("paperTrialStartedAt" in payload) {
    values.paperTrialStartedAt = optionalIsoDate(
      payload.paperTrialStartedAt,
      "paperTrialStartedAt",
    );
  }

  const nextPaperTrialStartedAt =
    values.paperTrialStartedAt === undefined
      ? current.paperTrialStartedAt
      : values.paperTrialStartedAt;
  const nextOnboardingComplete =
    values.onboardingComplete ?? current.onboardingComplete;
  const nextLedgerReconciledAt =
    values.ledgerReconciledAt === undefined
      ? current.ledgerReconciledAt
      : values.ledgerReconciledAt;
  if (
    nextPaperTrialStartedAt &&
    (!nextOnboardingComplete || !nextLedgerReconciledAt)
  ) {
    throw new ApiError(
      "Complete onboarding and reconcile the ledger before starting or continuing the paper trial.",
    );
  }

  const db = await getReadyDb();
  await db
    .update(ownerSettings)
    .set(values)
    .where(eq(ownerSettings.ownerEmail, ownerEmail));
  return getOrCreateSettings(ownerEmail);
}

function mapSettings(
  row: typeof ownerSettings.$inferSelect,
): OwnerSettings {
  return {
    ownerEmail: row.ownerEmail,
    onboardingComplete: row.onboardingComplete,
    horizonYears: row.horizonYears,
    lossTolerancePct: row.lossTolerancePct,
    emergencyFundConfirmed: row.emergencyFundConfirmed,
    usdAccountEnabled: row.usdAccountEnabled,
    tfsaRoomEstimateCad: row.tfsaRoomEstimateCad,
    tfsaAnnualLimitCad: row.tfsaAnnualLimitCad,
    availableCashCad: row.availableCashCad,
    exclusions: parseStringArray(row.exclusionsJson),
    watchlist: parseStringArray(row.watchlistJson),
    etfCoreTargetPct: row.etfCoreTargetPct,
    individualStocksMaxPct: row.individualStocksMaxPct,
    singleStockMaxPct: row.singleStockMaxPct,
    providerMode: row.providerMode === "full" ? "full" : "trial",
    quoteEntitlementVerified: row.quoteEntitlementVerified,
    liveLabelsAcknowledged: row.liveLabelsAcknowledged,
    ledgerReconciledAt: row.ledgerReconciledAt,
    paperTrialStartedAt: row.paperTrialStartedAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeStringList(
  value: unknown,
  field: string,
  limit: number,
): string[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new ApiError(`${field} must be a list with at most ${limit} items.`);
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/[\u0000-\u001f\u007f]/g, " ").trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 100)),
    ),
  );
}

function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ApiError(`${field} must be an ISO date or null.`);
  }
  return new Date(value).toISOString();
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
