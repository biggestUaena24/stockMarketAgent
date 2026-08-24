import { and, desc, eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { evidence } from "@/db/schema";
import {
  parseSavedProviderQuote,
  type SavedProviderQuote,
} from "@/lib/portfolio-market-quote";

export async function listLatestSavedProviderQuotes(
  ownerEmail: string,
  limit = 500,
): Promise<SavedProviderQuote[]> {
  const db = await getReadyDb();
  const rows = await db
    .select({
      canonicalSymbol: evidence.canonicalSymbol,
      factsJson: evidence.extractedFactsJson,
      marketDataTime: evidence.marketDataTime,
      createdAt: evidence.createdAt,
      provider: evidence.provider,
      sourceUrl: evidence.sourceUrl,
      freshness: evidence.freshness,
    })
    .from(evidence)
    .where(
      and(
        eq(evidence.ownerEmail, ownerEmail),
        eq(evidence.category, "quote"),
      ),
    )
    .orderBy(desc(evidence.marketDataTime), desc(evidence.createdAt))
    .limit(Math.min(Math.max(limit, 1), 2_000));

  const latestBySymbol = new Map<string, SavedProviderQuote>();
  for (const row of rows) {
    const quote = parseSavedProviderQuote(row);
    if (!quote || latestBySymbol.has(quote.canonicalSymbol)) continue;
    latestBySymbol.set(quote.canonicalSymbol, quote);
  }
  return [...latestBySymbol.values()];
}
