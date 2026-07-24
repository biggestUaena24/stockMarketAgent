import { eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { providerCache } from "@/db/schema";
import type {
  ProviderCache,
  ProviderCacheEntry,
} from "@/lib/research/providers/http";

export class D1ProviderCache implements ProviderCache {
  constructor(private readonly provider: string) {}

  async get<T>(key: string): Promise<ProviderCacheEntry<T> | null> {
    const db = await getReadyDb();
    const [row] = await db
      .select()
      .from(providerCache)
      .where(eq(providerCache.cacheKey, key))
      .limit(1);
    if (!row) return null;
    try {
      return {
        data: JSON.parse(row.payloadJson) as T,
        storedAt: row.cachedAt,
        expiresAt: row.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void> {
    const db = await getReadyDb();
    await db
      .insert(providerCache)
      .values({
        cacheKey: key,
        provider: this.provider,
        payloadJson: JSON.stringify(entry.data),
        marketDataTime: extractAsOf(entry.data),
        cachedAt: entry.storedAt,
        expiresAt: entry.expiresAt,
      })
      .onConflictDoUpdate({
        target: providerCache.cacheKey,
        set: {
          provider: this.provider,
          payloadJson: JSON.stringify(entry.data),
          marketDataTime: extractAsOf(entry.data),
          cachedAt: entry.storedAt,
          expiresAt: entry.expiresAt,
        },
      });
  }
}

function extractAsOf(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "asOf" in value &&
    typeof value.asOf === "string"
  ) {
    return value.asOf;
  }
  return null;
}
