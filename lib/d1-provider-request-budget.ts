import type {
  ProviderRequestBudget,
  ProviderRequestReservation,
  ProviderRequestReservationInput,
} from "@/lib/research/providers/request-budget";

export const DEFAULT_ALPHA_DAILY_REQUEST_LIMIT = 24;

const DAY_MS = 24 * 60 * 60 * 1_000;

const RESERVE_REQUEST_SQL = `
  INSERT INTO provider_request_budgets (
    provider,
    credential_fingerprint,
    quota_date,
    used_count,
    scheduled_start_ms,
    updated_at
  )
  VALUES (
    ?,
    ?,
    ?,
    1,
    MAX(
      ?,
      COALESCE(
        (
          SELECT MAX(scheduled_start_ms + ?)
          FROM provider_request_budgets
          WHERE provider = ?
            AND credential_fingerprint = ?
        ),
        ?
      )
    ),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(provider, credential_fingerprint, quota_date)
  DO UPDATE SET
    used_count = provider_request_budgets.used_count + 1,
    scheduled_start_ms = excluded.scheduled_start_ms,
    updated_at = CURRENT_TIMESTAMP
  WHERE provider_request_budgets.used_count < ?
  RETURNING used_count, scheduled_start_ms
`;

interface ReservationRow {
  used_count: unknown;
  scheduled_start_ms: unknown;
}

export interface D1ProviderRequestBudgetOptions {
  provider: string;
  credential: string;
  dailyLimit?: number;
  database?: D1Database;
}

function sha256Fingerprint(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(
    (digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
  );
}

function utcQuotaDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function nextUtcQuotaDateMs(quotaDate: string): number {
  return Date.parse(`${quotaDate}T00:00:00.000Z`) + DAY_MS;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return Number(value);
}

export class D1ProviderRequestBudget implements ProviderRequestBudget {
  private readonly provider: string;
  private readonly credentialFingerprint: Promise<string>;
  private readonly dailyLimit: number;
  private readonly databaseOverride?: D1Database;

  constructor(options: D1ProviderRequestBudgetOptions) {
    const provider = options.provider.trim();
    const credential = options.credential.trim();
    if (!provider) {
      throw new TypeError("provider is required.");
    }
    if (!credential) {
      throw new TypeError("credential is required.");
    }

    this.provider = provider;
    this.credentialFingerprint = sha256Fingerprint(credential);
    this.dailyLimit = positiveInteger(
      options.dailyLimit ?? DEFAULT_ALPHA_DAILY_REQUEST_LIMIT,
      "dailyLimit",
    );
    this.databaseOverride = options.database;
  }

  private async database(): Promise<D1Database> {
    if (this.databaseOverride) return this.databaseOverride;
    const { ensureDatabase, getRawDb } = await import("@/db");
    await ensureDatabase();
    return getRawDb();
  }

  async reserve(
    input: ProviderRequestReservationInput,
  ): Promise<ProviderRequestReservation> {
    const nowMs = nonNegativeInteger(input.nowMs, "nowMs");
    const spacingMs = nonNegativeInteger(input.spacingMs, "spacingMs");
    const quotaDate = utcQuotaDate(nowMs);
    const credentialFingerprint = await this.credentialFingerprint;
    const database = await this.database();

    const row = await database
      .prepare(RESERVE_REQUEST_SQL)
      .bind(
        this.provider,
        credentialFingerprint,
        quotaDate,
        nowMs,
        spacingMs,
        this.provider,
        credentialFingerprint,
        nowMs,
        this.dailyLimit,
      )
      .first<ReservationRow>();

    if (!row) {
      return {
        allowed: false,
        usedCount: this.dailyLimit,
        limit: this.dailyLimit,
        retryAt: nextUtcQuotaDateMs(quotaDate),
      };
    }

    const usedCount = positiveInteger(row.used_count, "reserved used_count");
    const scheduledAtMs = nonNegativeInteger(
      row.scheduled_start_ms,
      "reserved scheduled_start_ms",
    );
    if (usedCount > this.dailyLimit) {
      throw new Error("The provider request budget returned an invalid count.");
    }

    return {
      allowed: true,
      scheduledAtMs,
      usedCount,
      limit: this.dailyLimit,
    };
  }
}
