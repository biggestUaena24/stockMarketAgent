const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ProviderRequestReservationInput {
  operation: string;
  cacheKey: string;
  nowMs: number;
  spacingMs: number;
}

export type ProviderRequestReservation =
  | {
      allowed: true;
      scheduledAtMs: number;
      usedCount: number;
      limit: number;
    }
  | {
      allowed: false;
      usedCount: number;
      limit: number;
      retryAt: number;
    };

/**
 * A request budget is consulted only after a provider-cache miss. Implementors
 * may coordinate reservations in memory, durable storage, or another atomic
 * service without exposing provider credentials in the reservation key.
 */
export interface ProviderRequestBudget {
  reserve(
    input: ProviderRequestReservationInput,
  ): ProviderRequestReservation | Promise<ProviderRequestReservation>;
}

export interface InMemoryProviderRequestBudgetOptions {
  limit?: number;
}

/**
 * Process-local default for one research run. A shared implementation can be
 * injected when reservations must be coordinated across worker invocations.
 */
export class InMemoryProviderRequestBudget implements ProviderRequestBudget {
  private readonly limit: number;
  private dayStartMs = Number.NaN;
  private usedCount = 0;
  private nextRequestAtMs = 0;

  constructor(options: InMemoryProviderRequestBudgetOptions = {}) {
    const limit = options.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("limit must be a positive safe integer.");
    }
    this.limit = limit;
  }

  reserve(
    input: ProviderRequestReservationInput,
  ): ProviderRequestReservation {
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      throw new TypeError("nowMs must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(input.spacingMs) || input.spacingMs < 0) {
      throw new TypeError("spacingMs must be a non-negative safe integer.");
    }
    const nowMs = input.nowMs;
    const spacingMs = input.spacingMs;
    const dayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;

    if (dayStartMs !== this.dayStartMs) {
      this.dayStartMs = dayStartMs;
      this.usedCount = 0;
      this.nextRequestAtMs = nowMs;
    }

    if (this.usedCount >= this.limit) {
      return {
        allowed: false,
        usedCount: this.usedCount,
        limit: this.limit,
        retryAt: dayStartMs + DAY_MS,
      };
    }

    const scheduledAtMs = Math.max(nowMs, this.nextRequestAtMs);
    this.usedCount += 1;
    this.nextRequestAtMs = scheduledAtMs + spacingMs;
    return {
      allowed: true,
      scheduledAtMs,
      usedCount: this.usedCount,
      limit: this.limit,
    };
  }
}
