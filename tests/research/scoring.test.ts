import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEARCH_FACTOR_WEIGHTS,
  calculateWeightedResearchScore,
  decideResearchAction,
  hasCorroboratingBearishEvidence,
  type BearishEvidence,
  type FactorEvidence,
  type ResearchFactor,
  type ResearchFactors,
} from "../../lib/research/scoring";
import type { GateAssessment } from "../../lib/research/types";

const passGate: GateAssessment = { status: "pass", reasons: [] };

function factor(score: number | null, confidence = 0.9): FactorEvidence {
  return {
    score,
    confidence,
    sourceIds: ["source-a"],
    asOf: "2026-07-23T14:00:00.000Z",
  };
}

function factorsAt(
  score: number,
  overrides: Partial<Record<ResearchFactor, FactorEvidence>> = {},
): ResearchFactors {
  return {
    quality: overrides.quality ?? factor(score),
    valuation: overrides.valuation ?? factor(score),
    growthEstimateTrend: overrides.growthEstimateTrend ?? factor(score),
    balanceSheetStrength:
      overrides.balanceSheetStrength ?? factor(score),
    priceTrendRisk: overrides.priceTrendRisk ?? factor(score),
    newsEvents: overrides.newsEvents ?? factor(score),
    sentiment: overrides.sentiment ?? factor(score),
  };
}

test("uses the exact 25/20/15/15/10/10/5 weighting", () => {
  assert.deepEqual(RESEARCH_FACTOR_WEIGHTS, {
    quality: 25,
    valuation: 20,
    growthEstimateTrend: 15,
    balanceSheetStrength: 15,
    priceTrendRisk: 10,
    newsEvents: 10,
    sentiment: 5,
  });
  assert.equal(
    Object.values(RESEARCH_FACTOR_WEIGHTS).reduce(
      (sum, weight) => sum + weight,
      0,
    ),
    100,
  );

  const score = calculateWeightedResearchScore(factorsAt(100));
  assert.equal(score.total, 100);
  assert.deepEqual(score.contributions, RESEARCH_FACTOR_WEIGHTS);
  assert.equal(score.nonSentimentContribution, 95);
  assert.equal(score.sentimentContribution, 5);
  assert.equal(score.fundamentalComposite, 100);
});

test("applies the approved action bands and ownership wording", () => {
  const decide = (score: number, owned = false) =>
    decideResearchAction({
      factors: factorsAt(score),
      owned,
      evidenceGate: passGate,
      universeGate: passGate,
      portfolioRiskGate: passGate,
    }).action;

  assert.equal(decide(75), "consider-candidate");
  assert.equal(decide(74), "watch");
  assert.equal(decide(74, true), "hold");
  assert.equal(decide(60), "watch");
  assert.equal(decide(60, true), "hold");
  assert.equal(decide(45), "review");
});

test("requires corroborating non-sentiment evidence below 45", () => {
  const sentimentOnly: BearishEvidence[] = [
    {
      category: "sentiment",
      sourceId: "social-feed",
      summary: "Negative social tone",
    },
    {
      category: "newsEvents",
      sourceId: "filing-feed",
      summary: "Negative article",
    },
  ];
  assert.equal(hasCorroboratingBearishEvidence(sentimentOnly), false);

  const corroborated: BearishEvidence[] = [
    {
      category: "quality",
      sourceId: "filing",
      summary: "Margin deterioration",
    },
    {
      category: "balanceSheetStrength",
      sourceId: "balance-sheet",
      summary: "Leverage increased",
    },
  ];
  assert.equal(hasCorroboratingBearishEvidence(corroborated), true);

  const withoutCorroboration = decideResearchAction({
    factors: factorsAt(44),
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
    bearishEvidence: sentimentOnly,
  });
  assert.equal(withoutCorroboration.action, "review");

  const avoid = decideResearchAction({
    factors: factorsAt(44),
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
    bearishEvidence: corroborated,
  });
  assert.equal(avoid.action, "avoid");

  const exit = decideResearchAction({
    factors: factorsAt(44),
    owned: true,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
    bearishEvidence: corroborated,
  });
  assert.equal(exit.action, "exit-candidate");
});

test("sentiment cannot override fundamental or portfolio-risk blocks", () => {
  const strongestPossibleSentiment = factorsAt(100);

  const fundamentalBlock = decideResearchAction({
    factors: strongestPossibleSentiment,
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
    criticalFundamentalFlags: ["Material going-concern warning."],
  });
  assert.equal(fundamentalBlock.score.sentimentContribution, 5);
  assert.equal(fundamentalBlock.action, "review");

  const portfolioBlock = decideResearchAction({
    factors: strongestPossibleSentiment,
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: {
      status: "block",
      reasons: [
        {
          code: "position-concentration",
          message: "The portfolio is already too concentrated.",
        },
      ],
    },
  });
  assert.equal(portfolioBlock.action, "review");
});

test("missing, stale, or conflicting evidence produces Insufficient data", () => {
  const missingFactor = decideResearchAction({
    factors: factorsAt(80, { valuation: factor(null) }),
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
  });
  assert.equal(missingFactor.action, "insufficient-data");

  for (const code of ["stale-quote", "conflict-price"]) {
    const blocked = decideResearchAction({
      factors: factorsAt(80),
      owned: false,
      evidenceGate: {
        status: "block",
        reasons: [{ code, message: "Blocked evidence" }],
      },
      universeGate: passGate,
      portfolioRiskGate: passGate,
    });
    assert.equal(blocked.action, "insufficient-data");
  }
});

test("high scores require high confidence for Consider candidate", () => {
  const mediumConfidence = factorsAt(90);
  const withLowConfidence: ResearchFactors = {
    ...mediumConfidence,
    quality: factor(90, 0.2),
  };
  const decision = decideResearchAction({
    factors: withLowConfidence,
    owned: false,
    evidenceGate: passGate,
    universeGate: passGate,
    portfolioRiskGate: passGate,
  });
  assert.equal(decision.score.confidence, "medium");
  assert.equal(decision.action, "watch");
});
