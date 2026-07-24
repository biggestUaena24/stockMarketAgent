import { and, desc, eq, inArray } from "drizzle-orm";
import { getReadyDb } from "@/db";
import {
  evidence,
  recommendations,
  researchRuns,
} from "@/db/schema";

export type EvidenceView = {
  id: string;
  symbol: string;
  sourceUrl: string;
  category: string;
  publicationTime: string | null;
  marketDataTime: string | null;
  facts: string[];
  sentiment: number | null;
  freshness: string;
  provider: string;
};

export type RecommendationView = {
  id: string;
  symbol: string;
  action: string;
  score: number | null;
  confidence: string;
  valuationLow: number | null;
  valuationHigh: number | null;
  valuationCurrency: string | null;
  thesis: string;
  contraryEvidence: string[];
  catalysts: string[];
  risks: string[];
  portfolioImpact: string;
  allocationCapPct: number;
  invalidationConditions: string[];
  evidenceIds: string[];
  quoteDelayMinutes: number | null;
  dataAsOf: string | null;
  researchOnly: boolean;
  evidence: EvidenceView[];
};

export type ResearchRunView = {
  id: string;
  idempotencyKey: string;
  slot: string;
  scheduledTime: string;
  actualTime: string;
  status: string;
  dataFreshness: string;
  providerVersion: string;
  modelVersion: string;
  marketState: Record<string, unknown>;
  summary: Record<string, unknown>;
  errors: string[];
  completedAt: string | null;
  recommendations: RecommendationView[];
};

export async function listResearchRuns(
  ownerEmail: string,
  limit = 30,
): Promise<ResearchRunView[]> {
  const db = await getReadyDb();
  const runRows = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.ownerEmail, ownerEmail))
    .orderBy(desc(researchRuns.actualTime))
    .limit(Math.min(Math.max(limit, 1), 100));
  if (runRows.length === 0) return [];
  const runIds = runRows.map((run) => run.id);
  const [recommendationRows, evidenceRows] = await Promise.all([
    db
      .select()
      .from(recommendations)
      .where(inArray(recommendations.runId, runIds)),
    db.select().from(evidence).where(inArray(evidence.runId, runIds)),
  ]);

  const evidenceById = new Map(
    evidenceRows.map((item) => [item.id, mapEvidence(item)]),
  );
  const recommendationsByRun = new Map<string, RecommendationView[]>();
  for (const row of recommendationRows) {
    const ids = parseStringArray(row.evidenceIdsJson);
    const mapped = mapRecommendation(
      row,
      ids.flatMap((id) => {
        const found = evidenceById.get(id);
        return found ? [found] : [];
      }),
    );
    const current = recommendationsByRun.get(row.runId) ?? [];
    current.push(mapped);
    recommendationsByRun.set(row.runId, current);
  }

  return runRows.map((row) => ({
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    slot: row.slot,
    scheduledTime: row.scheduledTime,
    actualTime: row.actualTime,
    status: row.status,
    dataFreshness: row.dataFreshness,
    providerVersion: row.providerVersion,
    modelVersion: row.modelVersion,
    marketState: parseObject(row.marketStateJson),
    summary: parseObject(row.reportJson),
    errors: parseStringArray(row.errorsJson),
    completedAt: row.completedAt,
    recommendations: (recommendationsByRun.get(row.id) ?? []).sort(
      (left, right) => (right.score ?? -1) - (left.score ?? -1),
    ),
  }));
}

export async function latestResearchForSymbol(
  ownerEmail: string,
  symbol: string,
): Promise<RecommendationView | null> {
  const db = await getReadyDb();
  const [row] = await db
    .select()
    .from(recommendations)
    .where(
      and(
        eq(recommendations.ownerEmail, ownerEmail),
        eq(recommendations.canonicalSymbol, symbol.toUpperCase()),
      ),
    )
    .orderBy(desc(recommendations.createdAt))
    .limit(1);
  if (!row) return null;
  const ids = parseStringArray(row.evidenceIdsJson);
  const evidenceRows =
    ids.length > 0
      ? await db.select().from(evidence).where(inArray(evidence.id, ids))
      : [];
  return mapRecommendation(row, evidenceRows.map(mapEvidence));
}

function mapRecommendation(
  row: typeof recommendations.$inferSelect,
  evidenceItems: EvidenceView[],
): RecommendationView {
  return {
    id: row.id,
    symbol: row.canonicalSymbol,
    action: row.action,
    score: row.score,
    confidence: row.confidence,
    valuationLow: row.valuationLow,
    valuationHigh: row.valuationHigh,
    valuationCurrency: row.valuationCurrency,
    thesis: row.thesis,
    contraryEvidence: parseStringArray(row.contraryEvidenceJson),
    catalysts: parseStringArray(row.catalystsJson),
    risks: parseStringArray(row.risksJson),
    portfolioImpact: row.portfolioImpact,
    allocationCapPct: row.allocationCapPct,
    invalidationConditions: parseStringArray(row.invalidationConditionsJson),
    evidenceIds: parseStringArray(row.evidenceIdsJson),
    quoteDelayMinutes: row.quoteDelayMinutes,
    dataAsOf: row.dataAsOf,
    researchOnly: row.researchOnly,
    evidence: evidenceItems,
  };
}

function mapEvidence(row: typeof evidence.$inferSelect): EvidenceView {
  return {
    id: row.id,
    symbol: row.canonicalSymbol,
    sourceUrl: row.sourceUrl,
    category: row.category,
    publicationTime: row.publicationTime,
    marketDataTime: row.marketDataTime,
    facts: parseStringArray(row.extractedFactsJson),
    sentiment: row.sentiment,
    freshness: row.freshness,
    provider: row.provider,
  };
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

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
