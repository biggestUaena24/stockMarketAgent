import { and, asc, eq } from "drizzle-orm";
import { getReadyDb } from "@/db";
import {
  evidence as evidenceTable,
  recommendations,
  researchRuns,
} from "@/db/schema";
import {
  RESEARCH_MODEL,
  explainSavedResearch,
  type ResearchExplanation,
  type SavedEvidence,
} from "@/lib/ai/research-explainer";
import {
  calgaryDateKey,
  scheduledTimeUtc,
  type ResearchSlot,
} from "@/lib/calgary-time";
import { D1ProviderCache } from "@/lib/d1-provider-cache";
import { sendResearchRunEmail } from "@/lib/email";
import { newId, sha256 } from "@/lib/ids";
import { marketCalendarState } from "@/lib/market-calendar";
import {
  queuePaperDecision,
  recordBenchmarkObservation,
  recordPaperObservation,
  settleQueuedPaperTrades,
} from "@/lib/paper";
import { buildPortfolioView } from "@/lib/portfolio-view";
import {
  ALPHA_VANTAGE_TRIAL_PROFILE,
  AlphaVantageTrialProvider,
  FMP_FULL_PROFILE,
  FmpFullProvider,
  FULL_RESEARCH_FRESHNESS_POLICY,
  TRIAL_RESEARCH_FRESHNESS_POLICY,
  assessEvidenceQuality,
  assessSafetyUniverse,
  calculateWeightedResearchScore,
  decideResearchAction,
  evaluateOperationalReadiness,
  selectResearchSymbols,
  type FactorEvidence,
  type GateAssessment,
  type MarketResearchProvider,
  type NormalizedAnalystEstimates,
  type NormalizedCompanyFacts,
  type NormalizedNewsItem,
  type NormalizedQuote,
  type ProviderResult,
  type ResearchArtifact,
  type ResearchFactors,
} from "@/lib/research";
import {
  getOrCreateSettings,
  updateOwnerSettings,
  type OwnerSettings,
} from "@/lib/settings";
import { listTransactions } from "@/lib/transactions";
import { getRuntimeEnv } from "@/lib/runtime-env";

export type RunRequest = {
  ownerEmail: string;
  slot: ResearchSlot;
  scheduledTime?: string;
  idempotencyKey: string;
  trigger: "scheduled" | "manual";
};

export type RunResult = {
  runId: string;
  idempotencyKey: string;
  status: string;
  duplicate: boolean;
  researchedSymbols: string[];
  rejectedSymbols: string[];
  recommendationCount: number;
  errors: string[];
};

type PersistableEvidence = SavedEvidence & {
  symbol: string;
  sentiment: number | null;
  provider: string;
  contentHash: string;
};

type ProviderBundle = {
  quote: ProviderResult<NormalizedQuote>;
  facts: ProviderResult<NormalizedCompanyFacts>;
  estimates: ProviderResult<NormalizedAnalystEstimates> | null;
  news: ProviderResult<NormalizedNewsItem[]>;
};

const broadEtfSymbols = new Set([
  "XGRO",
  "VGRO",
  "XEQT",
  "VEQT",
  "VCN",
  "VUN",
  "XIC",
  "VFV",
  "ZSP",
  "VTI",
  "VOO",
  "VT",
  "SPY",
]);

export async function executeResearchRun(
  request: RunRequest,
): Promise<RunResult> {
  const db = await getReadyDb();
  const [existing] = await db
    .select({ id: researchRuns.id, status: researchRuns.status })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.ownerEmail, request.ownerEmail),
        eq(researchRuns.idempotencyKey, request.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      runId: existing.id,
      idempotencyKey: request.idempotencyKey,
      status: existing.status,
      duplicate: true,
      researchedSymbols: [],
      rejectedSymbols: [],
      recommendationCount: 0,
      errors: [],
    };
  }

  const now = new Date();
  const runId = newId("run");
  const settings = await getOrCreateSettings(request.ownerEmail);
  if (!settings.paperTrialStartedAt) {
    await updateOwnerSettings(request.ownerEmail, {
      paperTrialStartedAt: now.toISOString(),
    });
    settings.paperTrialStartedAt = now.toISOString();
  }
  const provider = providerFor(settings);
  const transactions = await listTransactions(request.ownerEmail, 2_000);
  const portfolio = buildPortfolioView(transactions, settings);
  const localDate = calgaryDateKey(now);
  const calendar = marketCalendarState(localDate);
  const requestedSymbols = collectSymbols(settings, portfolio.holdings);
  const selection = selectResearchSymbols(requestedSymbols, provider.profile);
  const errors = [...selection.reasons, ...portfolio.errors];
  const actualTime = now.toISOString();
  const scheduledTime =
    request.scheduledTime ?? scheduledTimeUtc(now, request.slot);

  await db.insert(researchRuns).values({
    id: runId,
    ownerEmail: request.ownerEmail,
    idempotencyKey: request.idempotencyKey,
    slot: request.slot,
    scheduledTime,
    actualTime,
    status: "running",
    dataFreshness: "unknown",
    providerVersion: `${provider.profile.id}:${provider.profile.mode}`,
    modelVersion: RESEARCH_MODEL,
    marketStateJson: JSON.stringify(calendar),
    reportJson: JSON.stringify({
      focus:
        request.slot === "morning"
          ? "Prior-close and overnight evidence; expect opening volatility."
          : "Completed-session review and preparation for the next session.",
      trigger: request.trigger,
      researchOnly: true,
    }),
    errorsJson: "[]",
  });

  let recommendationCount = 0;
  let blockedByData = 0;
  for (const symbol of selection.accepted) {
    try {
      const outcome = await researchOne({
        ownerEmail: request.ownerEmail,
        runId,
        symbol,
        provider,
        settings,
        portfolio,
        now,
      });
      recommendationCount += 1;
      if (outcome.insufficient) blockedByData += 1;
      errors.push(...outcome.warnings);
    } catch (error) {
      blockedByData += 1;
      errors.push(
        `${symbol}: ${
          error instanceof Error ? error.message : "research failed"
        }`,
      );
    }
  }

  const noConfiguredData =
    !providerKeyConfigured(settings.providerMode) ||
    selection.accepted.length === 0;
  const status =
    noConfiguredData ||
    recommendationCount === 0 ||
    blockedByData === recommendationCount
      ? "degraded"
      : "complete";
  const completedAt = new Date().toISOString();
  const dataFreshness =
    status === "complete" && blockedByData === 0 ? "verified" : "limited";

  await db
    .update(researchRuns)
    .set({
      status,
      dataFreshness,
      errorsJson: JSON.stringify(unique(errors)),
      reportJson: JSON.stringify({
        focus:
          request.slot === "morning"
            ? "Prior-close and overnight evidence; expect opening volatility."
            : "Completed-session review and preparation for the next session.",
        marketCalendar: calendar,
        researchedSymbols: selection.accepted,
        rejectedSymbols: selection.rejected,
        provider: provider.profile.displayName,
        providerWarnings: provider.profile.warnings,
        researchOnly:
          settings.providerMode === "trial" ||
          !settings.liveLabelsAcknowledged ||
          !settings.quoteEntitlementVerified,
        execution: "Manual Wealthsimple trade only",
      }),
      completedAt,
    })
    .where(eq(researchRuns.id, runId));

  if (request.trigger === "scheduled") {
    const delivery = await sendResearchRunEmail(request.ownerEmail, runId);
    if (delivery.status === "failed") {
      errors.push(`Email delivery: ${delivery.reason}`);
      await db
        .update(researchRuns)
        .set({ errorsJson: JSON.stringify(unique(errors)) })
        .where(eq(researchRuns.id, runId));
    }
  }

  return {
    runId,
    idempotencyKey: request.idempotencyKey,
    status,
    duplicate: false,
    researchedSymbols: selection.accepted,
    rejectedSymbols: selection.rejected,
    recommendationCount,
    errors: unique(errors),
  };
}

async function researchOne(input: {
  ownerEmail: string;
  runId: string;
  symbol: string;
  provider: MarketResearchProvider;
  settings: OwnerSettings;
  portfolio: ReturnType<typeof buildPortfolioView>;
  now: Date;
}): Promise<{ insufficient: boolean; warnings: string[] }> {
  const providerSymbol = symbolForProvider(
    input.symbol,
    input.provider.profile.id,
  );
  const estimatesPromise =
    input.provider.profile.capabilities.analystEstimates
      ? input.provider.getAnalystEstimates(providerSymbol)
      : Promise.resolve(null);
  const [quote, facts, estimates, news] = await Promise.all([
    input.provider.getQuote(providerSymbol),
    input.provider.getCompanyFacts(providerSymbol),
    estimatesPromise,
    input.provider.getNews(providerSymbol, { limit: 12 }),
  ]);
  const bundle: ProviderBundle = { quote, facts, estimates, news };
  const warnings = collectProviderWarnings(bundle);
  const persistedEvidence = await buildAndPersistEvidence({
    ownerEmail: input.ownerEmail,
    runId: input.runId,
    symbol: input.symbol,
    bundle,
    provider: input.provider,
    portfolio: input.portfolio,
    now: input.now,
  });
  const artifacts = evidenceArtifacts(persistedEvidence, bundle, input.now);
  const observations = conflictObservations(bundle);
  const evidenceGate = assessEvidenceQuality(
    artifacts,
    observations,
    input.now,
    input.provider.profile.mode === "full"
      ? FULL_RESEARCH_FRESHNESS_POLICY
      : TRIAL_RESEARCH_FRESHNESS_POLICY,
  );
  const factors = buildFactors(bundle, persistedEvidence);
  const preliminaryScore = calculateWeightedResearchScore(factors);
  const ownedHolding = findHolding(input.portfolio.holdings, input.symbol);
  const universeGate = buildUniverseGate(input.symbol, bundle);
  const portfolioRiskGate = buildPortfolioRiskGate({
    settings: input.settings,
    holding: ownedHolding,
    bundle,
  });
  const paperTrial = await paperTrialRecord(
    input.ownerEmail,
    input.settings,
    input.now,
  );
  const operationalReadiness = evaluateOperationalReadiness({
    provider: input.provider.profile,
    evaluationDate: input.now.toISOString(),
    paperTrial,
    quoteEntitlementVerified: input.settings.quoteEntitlementVerified,
    explicitUserAcknowledgementAt: input.settings.liveLabelsAcknowledged
      ? input.settings.updatedAt
      : null,
    confidence: preliminaryScore.confidence,
    evidenceGate,
    universeGate,
    portfolioRiskGate,
  });
  const decision = decideResearchAction({
    factors,
    owned: Boolean(ownedHolding),
    evidenceGate,
    universeGate,
    portfolioRiskGate,
    bearishEvidence: bearishEvidence(factors),
    operationalReadiness,
  });
  const displayedAction =
    decision.liveLabelEligible
      ? decision.label
      : decision.action === "consider-candidate"
        ? ownedHolding
          ? "Hold"
          : "Watch"
        : decision.action === "exit-candidate"
          ? "Review"
          : decision.label;
  const explanation = await safeExplanation({
    ownerEmail: input.ownerEmail,
    symbol: input.symbol,
    action: displayedAction,
    score: decision.score.total,
    confidence: decision.score.confidence,
    evidence: persistedEvidence,
  });
  const quoteData = bundle.quote.ok ? bundle.quote.data : null;
  const factsData = bundle.facts.ok ? bundle.facts.data : null;
  const valuationRange = deterministicValuationRange(quoteData, factsData);
  const allocationCapPct =
    factsData?.assetType === "etf"
      ? input.settings.etfCoreTargetPct
      : input.settings.singleStockMaxPct;
  const dataAsOf = newestTimestamp(
    persistedEvidence.flatMap((item) => [
      item.marketDataTime,
      item.publicationTime,
    ]),
  );
  const quoteDelayMinutes =
    quoteData && Number.isFinite(Date.parse(quoteData.asOf))
      ? Math.max(
          0,
          Math.round(
            (input.now.getTime() - Date.parse(quoteData.asOf)) / 60_000,
          ),
        )
      : null;
  const evidenceIds = persistedEvidence.map((item) => item.id);
  const recommendationId = newId("rec");
  const db = await getReadyDb();
  await db.insert(recommendations).values({
    id: recommendationId,
    ownerEmail: input.ownerEmail,
    runId: input.runId,
    canonicalSymbol: input.symbol,
    action: displayedAction,
    score: decision.score.total,
    confidence: decision.score.confidence,
    valuationLow: valuationRange?.low ?? null,
    valuationHigh: valuationRange?.high ?? null,
    valuationCurrency: valuationRange?.currency ?? null,
    thesis: explanation.thesis,
    contraryEvidenceJson: JSON.stringify(
      explanation.contraryEvidence.map((item) => item.text),
    ),
    catalystsJson: JSON.stringify(
      explanation.catalysts.map((item) => item.text),
    ),
    risksJson: JSON.stringify([
      ...explanation.risks.map((item) => item.text),
      ...decision.reasons.slice(0, 4).map((item) => item.message),
    ]),
    portfolioImpact: portfolioImpact(
      ownedHolding?.allocationPct ?? 0,
      factsData?.assetType === "etf",
      input.settings,
    ),
    allocationCapPct,
    invalidationConditionsJson: JSON.stringify(
      explanation.invalidationConditions.map((item) => item.text),
    ),
    evidenceIdsJson: JSON.stringify(evidenceIds),
    quoteDelayMinutes,
    dataAsOf,
    researchOnly: !decision.liveLabelEligible,
  });
  if (quoteData?.currency === "CAD") {
    await settleQueuedPaperTrades({
      ownerEmail: input.ownerEmail,
      symbol: input.symbol,
      observedPrice: quoteData.price,
      observedAt: quoteData.asOf,
    });
    await recordPaperObservation({
      ownerEmail: input.ownerEmail,
      symbol: input.symbol,
      observedPrice: quoteData.price,
      observedAt: quoteData.asOf,
      fxRateToCad: 1,
    });
    if (input.symbol === "XGRO.TO") {
      await recordBenchmarkObservation({
        ownerEmail: input.ownerEmail,
        symbol: input.symbol,
        observedPrice: quoteData.price,
        observedAt: quoteData.asOf,
        fxRateToCad: 1,
      });
    }
    if (
      decision.action === "consider-candidate" ||
      decision.action === "exit-candidate"
    ) {
      await queuePaperDecision({
        ownerEmail: input.ownerEmail,
        recommendationId,
        symbol: input.symbol,
        action: decision.action,
        quantity: 1,
        decisionPrice: quoteData.price,
        currency: "CAD",
        fxRateToCad: 1,
        decisionTime: input.now.toISOString(),
        feesCad: 0,
      });
    }
  } else if (quoteData) {
    warnings.push(
      `Paper tracking skipped for ${input.symbol}: the provider did not supply an evidence-backed CAD conversion rate for the ${quoteData.currency ?? "unverified-currency"} quote.`,
    );
  }
  return {
    insufficient: decision.action === "insufficient-data",
    warnings: [
      ...warnings,
      ...evidenceGate.reasons.map((reason) => reason.message),
    ],
  };
}

function providerFor(settings: OwnerSettings): MarketResearchProvider {
  if (settings.providerMode === "full") {
    return new FmpFullProvider({
      apiKey: getRuntimeEnv("FMP_API_KEY"),
      cache: new D1ProviderCache("fmp"),
    });
  }
  return new AlphaVantageTrialProvider({
    apiKey: getRuntimeEnv("ALPHA_VANTAGE_API_KEY"),
    cache: new D1ProviderCache("alpha-vantage"),
  });
}

function providerKeyConfigured(mode: OwnerSettings["providerMode"]): boolean {
  return Boolean(
    getRuntimeEnv(mode === "full" ? "FMP_API_KEY" : "ALPHA_VANTAGE_API_KEY"),
  );
}

function collectSymbols(
  settings: OwnerSettings,
  holdings: ReturnType<typeof buildPortfolioView>["holdings"],
): string[] {
  return unique([
    ...holdings.map((holding) =>
      holding.exchange === "TSX"
        ? `${holding.symbol.replace(/\.TO$/i, "")}.TO`
        : holding.symbol,
    ),
    ...settings.watchlist,
  ]);
}

function symbolForProvider(
  canonical: string,
  provider: string,
): string {
  const symbol = canonical.toUpperCase();
  if (provider === "alpha-vantage") {
    if (symbol.endsWith(".TO")) return `${symbol.slice(0, -3)}.TRT`;
    if (symbol.endsWith(".V")) return `${symbol.slice(0, -2)}.TRV`;
  }
  return symbol;
}

async function buildAndPersistEvidence(input: {
  ownerEmail: string;
  runId: string;
  symbol: string;
  bundle: ProviderBundle;
  provider: MarketResearchProvider;
  portfolio: ReturnType<typeof buildPortfolioView>;
  now: Date;
}): Promise<PersistableEvidence[]> {
  const records: Array<Omit<PersistableEvidence, "id" | "contentHash">> = [];
  const providerUrl =
    input.provider.profile.id === "fmp"
      ? "https://site.financialmodelingprep.com/developer/docs"
      : "https://www.alphavantage.co/documentation/";

  if (input.bundle.quote.ok) {
    const value = input.bundle.quote.data;
    records.push({
      symbol: input.symbol,
      sourceUrl: input.bundle.quote.meta.endpoint || providerUrl,
      category: "quote",
      publicationTime: null,
      marketDataTime: value.asOf,
      facts: compactFacts([
        `The recorded provider price is ${value.price} ${value.currency ?? "in an unverified currency"}.`,
        value.previousClose === null
          ? null
          : `The recorded previous close is ${value.previousClose}.`,
        value.volume === null
          ? null
          : `The recorded volume is ${value.volume}.`,
        `The provider identifies the exchange as ${value.exchange}.`,
      ]),
      sentiment: null,
      freshness: input.bundle.quote.meta.cache.state,
      provider: input.provider.profile.id,
    });
  }
  if (input.bundle.facts.ok) {
    const value = input.bundle.facts.data;
    records.push({
      symbol: input.symbol,
      sourceUrl: input.bundle.facts.meta.endpoint || providerUrl,
      category: "fundamentals",
      publicationTime: null,
      marketDataTime: value.asOf,
      facts: compactFacts([
        value.name ? `The company name is ${value.name}.` : null,
        value.marketCap === null
          ? null
          : `Recorded market capitalization is ${value.marketCap} ${value.currency ?? ""}.`,
        value.trailingPe === null
          ? null
          : `Recorded trailing price-to-earnings is ${value.trailingPe}.`,
        value.returnOnEquity === null
          ? null
          : `Recorded return on equity is ${value.returnOnEquity}.`,
        value.netMargin === null
          ? null
          : `Recorded net margin is ${value.netMargin}.`,
        value.revenueGrowthYoY === null
          ? null
          : `Recorded year-over-year revenue growth is ${value.revenueGrowthYoY}.`,
        value.debtToEquity === null
          ? null
          : `Recorded debt-to-equity is ${value.debtToEquity}.`,
      ]),
      sentiment: null,
      freshness: input.bundle.facts.meta.cache.state,
      provider: input.provider.profile.id,
    });
    records.push({
      symbol: input.symbol,
      sourceUrl: filingUrl(value.exchange, input.symbol),
      category: "filing-reference",
      publicationTime: null,
      marketDataTime: value.asOf,
      facts: [
        value.exchange === "TSX"
          ? "Use SEDAR+ as the authoritative Canadian filing reference."
          : "Use SEC EDGAR as the authoritative United States filing reference.",
      ],
      sentiment: null,
      freshness: "reference",
      provider: value.exchange === "TSX" ? "SEDAR+" : "SEC EDGAR",
    });
  }
  if (input.bundle.estimates?.ok) {
    const value = input.bundle.estimates.data;
    records.push({
      symbol: input.symbol,
      sourceUrl: input.bundle.estimates.meta.endpoint || providerUrl,
      category: "analyst-estimates",
      publicationTime: null,
      marketDataTime: value.asOf,
      facts:
        value.estimates.length > 0
          ? value.estimates.slice(0, 4).map(
              (estimate) =>
                `For ${estimate.periodEnd}, the recorded average revenue estimate is ${estimate.revenueAverage ?? "unavailable"} and average EPS estimate is ${estimate.epsAverage ?? "unavailable"}.`,
            )
          : ["The provider returned no usable analyst estimates."],
      sentiment: null,
      freshness: input.bundle.estimates.meta.cache.state,
      provider: input.provider.profile.id,
    });
  }
  if (input.bundle.news.ok && input.bundle.news.data.length > 0) {
    for (const item of input.bundle.news.data.slice(0, 8)) {
      records.push({
        symbol: input.symbol,
        sourceUrl: item.url,
        category: "news",
        publicationTime: item.publishedAt,
        marketDataTime: null,
        facts: compactFacts([item.title, item.summary]),
        sentiment: item.providerSentiment,
        freshness: input.bundle.news.meta.cache.state,
        provider: item.source ?? input.provider.profile.id,
      });
    }
  } else if (input.bundle.news.ok) {
    records.push({
      symbol: input.symbol,
      sourceUrl: providerUrl,
      category: "news",
      publicationTime: input.now.toISOString(),
      marketDataTime: null,
      facts: ["The provider returned no recent company news."],
      sentiment: null,
      freshness: input.bundle.news.meta.cache.state,
      provider: input.provider.profile.id,
    });
  }

  const holding = findHolding(input.portfolio.holdings, input.symbol);
  records.push({
    symbol: input.symbol,
    sourceUrl: "/portfolio",
    category: "portfolio",
    publicationTime: null,
    marketDataTime: input.now.toISOString(),
    facts: [
      holding
        ? `The ledger shows a current position allocation of ${holding.allocationPct} percent.`
        : "The ledger shows no current holding in this security.",
      `Available cash entered by the owner is ${input.portfolio.availableCashCad} CAD.`,
    ],
    sentiment: null,
    freshness: "current-ledger",
    provider: "Cedar deterministic ledger",
  });

  for (const result of [
    input.bundle.quote,
    input.bundle.facts,
    input.bundle.news,
    ...(input.bundle.estimates ? [input.bundle.estimates] : []),
  ]) {
    if (!result.ok) {
      records.push({
        symbol: input.symbol,
        sourceUrl: providerUrl,
        category: "data-quality",
        publicationTime: null,
        marketDataTime: input.now.toISOString(),
        facts: [result.error.message],
        sentiment: null,
        freshness: "missing",
        provider: input.provider.profile.id,
      });
    }
  }

  const built: PersistableEvidence[] = [];
  for (const record of records) {
    const facts = record.facts.map(sanitizeFact).filter(Boolean);
    const id = newId("ev");
    built.push({
      ...record,
      id,
      facts,
      contentHash: await sha256(
        JSON.stringify({
          sourceUrl: record.sourceUrl,
          category: record.category,
          publicationTime: record.publicationTime,
          marketDataTime: record.marketDataTime,
          facts,
        }),
      ),
    });
  }

  const db = await getReadyDb();
  for (const record of built) {
    await db.insert(evidenceTable).values({
      id: record.id,
      ownerEmail: input.ownerEmail,
      runId: input.runId,
      canonicalSymbol: record.symbol,
      sourceUrl: record.sourceUrl,
      category: record.category,
      publicationTime: record.publicationTime,
      marketDataTime: record.marketDataTime,
      extractedFactsJson: JSON.stringify(record.facts),
      sentiment: record.sentiment,
      freshness: record.freshness,
      provider: record.provider,
      contentHash: record.contentHash,
    });
  }
  return built;
}

function buildFactors(
  bundle: ProviderBundle,
  evidence: PersistableEvidence[],
): ResearchFactors {
  const facts = bundle.facts.ok ? bundle.facts.data : null;
  const quote = bundle.quote.ok ? bundle.quote.data : null;
  const news = bundle.news.ok ? bundle.news.data : [];
  const fundamentalIds = evidence
    .filter((item) => item.category === "fundamentals")
    .map((item) => item.id);
  const quoteIds = evidence
    .filter((item) => item.category === "quote")
    .map((item) => item.id);
  const newsIds = evidence
    .filter((item) => item.category === "news")
    .map((item) => item.id);
  const factsAsOf = facts?.asOf ?? null;
  const quoteAsOf = quote?.asOf ?? null;
  const newsAsOf = newestTimestamp(news.map((item) => item.publishedAt));

  const qualityValues = facts
    ? compactNumbers([
        scoreHigher(normalizePercent(facts.returnOnEquity), -0.05, 0.25),
        scoreHigher(normalizePercent(facts.returnOnAssets), -0.03, 0.15),
        scoreHigher(normalizePercent(facts.operatingMargin), -0.05, 0.25),
        scoreHigher(normalizePercent(facts.netMargin), -0.05, 0.2),
        scoreHigher(normalizePercent(facts.freeCashFlowYield), 0, 0.08),
      ])
    : [];
  const valuationValues = facts
    ? compactNumbers([
        scoreLower(facts.trailingPe, 12, 45),
        scoreLower(facts.forwardPe, 12, 40),
        scoreLower(facts.priceToBook, 2, 8),
        scoreLower(facts.enterpriseValueToEbitda, 8, 28),
        scoreHigher(normalizePercent(facts.freeCashFlowYield), 0, 0.08),
      ])
    : [];
  const growthValues = facts
    ? compactNumbers([
        scoreHigher(normalizePercent(facts.revenueGrowthYoY), -0.1, 0.2),
        scoreHigher(normalizePercent(facts.earningsGrowthYoY), -0.2, 0.25),
      ])
    : [];
  const balanceValues = facts
    ? compactNumbers([
        scoreHigher(facts.currentRatio, 0.5, 2),
        scoreLower(facts.debtToEquity, 0.5, 3),
        scoreHigher(facts.interestCoverage, 1, 10),
      ])
    : [];
  const change = quote?.changePercent;
  const trendScore =
    change === null || change === undefined
      ? null
      : clamp(75 - Math.abs(change) * 4, 15, 80);
  const sentiments = news
    .map((item) => item.providerSentiment)
    .filter((value): value is number => value !== null);
  const averageSentiment =
    sentiments.length > 0 ? average(sentiments) : null;
  const newsScore =
    news.length === 0
      ? 50
      : clamp(50 + (averageSentiment ?? 0) * 15, 25, 75);
  const sentimentScore =
    averageSentiment === null
      ? 50
      : clamp(50 + averageSentiment * 50, 0, 100);

  return {
    quality: factor(
      averageOrNull(qualityValues),
      coverageConfidence(qualityValues, 4),
      fundamentalIds,
      factsAsOf,
    ),
    valuation: factor(
      averageOrNull(valuationValues),
      coverageConfidence(valuationValues, 4),
      fundamentalIds,
      factsAsOf,
    ),
    growthEstimateTrend: factor(
      averageOrNull(growthValues),
      coverageConfidence(growthValues, 2),
      fundamentalIds,
      factsAsOf,
    ),
    balanceSheetStrength: factor(
      averageOrNull(balanceValues),
      coverageConfidence(balanceValues, 3),
      fundamentalIds,
      factsAsOf,
    ),
    priceTrendRisk: factor(
      trendScore,
      trendScore === null ? 0 : 0.65,
      quoteIds,
      quoteAsOf,
    ),
    newsEvents: factor(
      newsScore,
      news.length >= 3 ? 0.85 : 0.55,
      newsIds,
      newsAsOf,
    ),
    sentiment: factor(
      sentimentScore,
      sentiments.length >= 3 ? 0.7 : 0.3,
      newsIds,
      newsAsOf,
    ),
  };
}

function buildUniverseGate(
  symbol: string,
  bundle: ProviderBundle,
): GateAssessment {
  if (!bundle.quote.ok || !bundle.facts.ok) {
    return {
      status: "block",
      reasons: [
        {
          code: "universe-data-missing",
          message:
            "Quote and company facts are required to verify the safety universe.",
        },
      ],
    };
  }
  const quote = bundle.quote.data;
  const facts = bundle.facts.data;
  const name = facts.name?.toLowerCase() ?? "";
  const base = baseSymbol(symbol);
  const leveraged = /\b(2x|3x|ultra|leveraged|daily bull)\b/.test(name);
  const inverse = /\b(inverse|short|bear)\b/.test(name);
  const broad =
    broadEtfSymbols.has(base) ||
    /\b(total market|broad market|all[- ]cap|asset allocation|balanced|s&p 500)\b/.test(
      name,
    );
  return assessSafetyUniverse({
    symbol,
    exchange: facts.exchange,
    currency: facts.currency ?? quote.currency,
    assetType: facts.assetType,
    price: quote.price,
    marketCap: facts.marketCap,
    fundAssets: facts.assetType === "etf" ? facts.marketCap : null,
    averageDailyDollarVolume:
      quote.averageVolume === null ? null : quote.averageVolume * quote.price,
    isBroadMarketEtf: broad,
    isLeveraged: leveraged,
    isInverse: inverse,
    isHalted: false,
    isDelisted: false,
    isWealthsimpleEligible: ["TSX", "NYSE", "NASDAQ"].includes(facts.exchange),
  });
}

function buildPortfolioRiskGate(input: {
  settings: OwnerSettings;
  holding: ReturnType<typeof buildPortfolioView>["holdings"][number] | null;
  bundle: ProviderBundle;
}): GateAssessment {
  const reasons: Array<{ code: string; message: string }> = [];
  if (!input.settings.emergencyFundConfirmed) {
    reasons.push({
      code: "emergency-fund-not-confirmed",
      message:
        "Confirm an emergency fund before considering additional investments.",
    });
  }
  const isEtf = input.bundle.facts.ok
    ? input.bundle.facts.data.assetType === "etf"
    : false;
  if (
    !isEtf &&
    input.holding &&
    input.holding.allocationPct > input.settings.singleStockMaxPct
  ) {
    reasons.push({
      code: "single-stock-cap-exceeded",
      message: "The current position exceeds the configured single-stock cap.",
    });
  }
  if (!input.holding && input.settings.availableCashCad <= 0) {
    reasons.push({
      code: "no-available-cash",
      message: "No available cash is recorded for a new position.",
    });
  }
  if (
    input.bundle.quote.ok &&
    input.bundle.quote.data.currency === "USD" &&
    !input.settings.usdAccountEnabled
  ) {
    reasons.push({
      code: "usd-fx-cost",
      message:
        "A United States trade is exposed to estimated Wealthsimple conversion costs.",
    });
  }
  return {
    status: reasons.some((item) =>
      [
        "emergency-fund-not-confirmed",
        "single-stock-cap-exceeded",
        "no-available-cash",
      ].includes(item.code),
    )
      ? "block"
      : reasons.length > 0
        ? "caution"
        : "pass",
    reasons,
  };
}

function evidenceArtifacts(
  evidence: PersistableEvidence[],
  bundle: ProviderBundle,
  now: Date,
): ResearchArtifact[] {
  return evidence.flatMap((item): ResearchArtifact[] => {
    const kind =
      item.category === "quote"
        ? "quote"
        : item.category === "fundamentals"
          ? "fundamentals"
          : item.category === "analyst-estimates"
            ? "analyst-estimates"
            : item.category === "news"
              ? "news"
              : item.category === "portfolio"
                ? "portfolio"
                : null;
    if (!kind) return [];
    return [
      {
        id: item.id,
        kind,
        source: item.provider,
        asOf:
          item.marketDataTime ?? item.publicationTime ?? now.toISOString(),
        fetchedAt: fetchedAtForCategory(item.category, bundle, now),
        cacheState: cacheState(item.freshness),
      },
    ];
  });
}

function conflictObservations(bundle: ProviderBundle) {
  if (!bundle.quote.ok || !bundle.facts.ok) return [];
  return [
    {
      field: "currency",
      source: "quote",
      value: bundle.quote.data.currency,
      asOf: bundle.quote.data.asOf,
    },
    {
      field: "currency",
      source: "fundamentals",
      value: bundle.facts.data.currency,
      asOf: bundle.facts.data.asOf,
    },
    {
      field: "exchange",
      source: "quote",
      value: bundle.quote.data.exchange,
      asOf: bundle.quote.data.asOf,
    },
    {
      field: "exchange",
      source: "fundamentals",
      value: bundle.facts.data.exchange,
      asOf: bundle.facts.data.asOf,
    },
  ];
}

async function paperTrialRecord(
  ownerEmail: string,
  settings: OwnerSettings,
  now: Date,
) {
  const db = await getReadyDb();
  const rows = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.ownerEmail, ownerEmail))
    .orderBy(asc(researchRuns.actualTime))
    .limit(500);
  const scheduled = rows.filter((row) =>
    /^\d{4}-\d{2}-\d{2}:(morning|evening)$/.test(row.idempotencyKey),
  );
  const successful = scheduled.filter((row) => row.status === "complete");
  const sessions = new Set(
    successful.flatMap((row) => {
      try {
        const state = JSON.parse(row.marketStateJson) as {
          localDate?: string;
          anyOpen?: boolean;
        };
        return state.anyOpen && state.localDate ? [state.localDate] : [];
      } catch {
        return [];
      }
    }),
  );
  return {
    startedOn:
      settings.paperTrialStartedAt ?? now.toISOString(),
    completedMarketSessions: sessions.size,
    scheduledRuns: scheduled.length,
    successfulRuns: successful.length,
    reconciliationPassed: Boolean(settings.ledgerReconciledAt),
    unresolvedDataQualityFailures: rows.filter(
      (row) => row.status === "degraded",
    ).length,
  };
}

async function safeExplanation(input: {
  ownerEmail: string;
  symbol: string;
  action: string;
  score: number | null;
  confidence: string;
  evidence: PersistableEvidence[];
}): Promise<ResearchExplanation> {
  try {
    return await explainSavedResearch(input);
  } catch {
    const first = input.evidence[0];
    return {
      summary: "The model explanation was unavailable; deterministic evidence remains.",
      thesis:
        first?.facts[0] ??
        "There is not enough verified evidence for a research thesis.",
      contraryEvidence: [],
      catalysts: [],
      risks: first
        ? [
            {
              text: "The saved evidence may become stale or be superseded.",
              evidenceIds: [first.id],
            },
          ]
        : [],
      invalidationConditions: first
        ? [
            {
              text: "Reassess when later source material contradicts the record.",
              evidenceIds: [first.id],
            },
          ]
        : [],
      citationEvidenceIds: first ? [first.id] : [],
      model: "deterministic",
      generatedBy: "deterministic_fallback",
    };
  }
}

function factor(
  score: number | null,
  confidence: number,
  sourceIds: string[],
  asOf: string | null,
): FactorEvidence {
  return {
    score: score === null ? null : Math.round(score * 100) / 100,
    confidence,
    sourceIds,
    asOf,
  };
}

function bearishEvidence(factors: ResearchFactors) {
  return Object.entries(factors).flatMap(([category, value]) =>
    value.score !== null && value.score < 40 && value.sourceIds[0]
      ? [
          {
            category: category as keyof ResearchFactors,
            sourceId: value.sourceIds[0],
            summary: `${category} is below the review threshold.`,
          },
        ]
      : [],
  );
}

function deterministicValuationRange(
  quote: NormalizedQuote | null,
  facts: NormalizedCompanyFacts | null,
): { low: number; high: number; currency: "CAD" | "USD" } | null {
  if (
    !quote ||
    !facts?.analystTargetPrice ||
    !facts.currency ||
    facts.analystTargetPrice <= 0
  ) {
    return null;
  }
  return {
    low: round2(facts.analystTargetPrice * 0.9),
    high: round2(facts.analystTargetPrice * 1.1),
    currency: facts.currency,
  };
}

function portfolioImpact(
  currentAllocation: number,
  isEtf: boolean,
  settings: OwnerSettings,
): string {
  if (isEtf) {
    return `Current tracked allocation is ${round2(currentAllocation)}%. Treat broad ETFs as part of the ${settings.etfCoreTargetPct}% core and check overlap before adding.`;
  }
  return `Current tracked allocation is ${round2(currentAllocation)}%. Individual stocks share a ${settings.individualStocksMaxPct}% sleeve and one stock is capped at ${settings.singleStockMaxPct}%.`;
}

function collectProviderWarnings(bundle: ProviderBundle): string[] {
  return unique(
    [
      bundle.quote,
      bundle.facts,
      bundle.news,
      ...(bundle.estimates ? [bundle.estimates] : []),
    ].flatMap((result) =>
      result.ok
        ? result.meta.warnings
        : [result.error.message, ...result.meta.warnings],
    ),
  );
}

function filingUrl(exchange: string, symbol: string): string {
  return exchange === "TSX"
    ? "https://www.sedarplus.ca/"
    : `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(
        baseSymbol(symbol),
      )}`;
}

function findHolding(
  holdings: ReturnType<typeof buildPortfolioView>["holdings"],
  symbol: string,
) {
  const base = baseSymbol(symbol);
  return (
    holdings.find((holding) => baseSymbol(holding.symbol) === base) ?? null
  );
}

function baseSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/\.(TO|TRT|V|TRV)$/i, "");
}

function compactFacts(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function compactNumbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function averageOrNull(values: number[]): number | null {
  return values.length ? average(values) : null;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coverageConfidence(values: number[], expected: number): number {
  if (values.length === 0) return 0;
  return clamp(0.45 + (values.length / expected) * 0.45, 0.45, 0.9);
}

function scoreHigher(
  value: number | null,
  floor: number,
  target: number,
): number | null {
  if (value === null) return null;
  return clamp(((value - floor) / (target - floor)) * 100, 0, 100);
}

function scoreLower(
  value: number | null,
  target: number,
  ceiling: number,
): number | null {
  if (value === null || value <= 0) return null;
  return clamp(100 - ((value - target) / (ceiling - target)) * 100, 0, 100);
}

function normalizePercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.abs(value) > 2 ? value / 100 : value;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function newestTimestamp(
  values: Array<string | null | undefined>,
): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

function fetchedAtForCategory(
  category: string,
  bundle: ProviderBundle,
  now: Date,
): string {
  const result =
    category === "quote"
      ? bundle.quote
      : category === "fundamentals"
        ? bundle.facts
        : category === "analyst-estimates"
          ? bundle.estimates
          : category === "news"
            ? bundle.news
            : null;
  return result?.meta.receivedAt ?? result?.meta.requestedAt ?? now.toISOString();
}

function cacheState(
  value: string,
): "not-configured" | "miss" | "hit" | "stale-fallback" | undefined {
  return ["not-configured", "miss", "hit", "stale-fallback"].includes(value)
    ? (value as "not-configured" | "miss" | "hit" | "stale-fallback")
    : undefined;
}

function sanitizeFact(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const researchProfiles = {
  trial: ALPHA_VANTAGE_TRIAL_PROFILE,
  full: FMP_FULL_PROFILE,
} as const;
