import type {
  ConfidenceLevel,
  OperationalReadiness,
} from "./readiness";
import type { GateAssessment, GateReason, GateStatus } from "./types";

export type ResearchFactor =
  | "quality"
  | "valuation"
  | "growthEstimateTrend"
  | "balanceSheetStrength"
  | "priceTrendRisk"
  | "newsEvents"
  | "sentiment";

export const RESEARCH_FACTOR_WEIGHTS = {
  quality: 25,
  valuation: 20,
  growthEstimateTrend: 15,
  balanceSheetStrength: 15,
  priceTrendRisk: 10,
  newsEvents: 10,
  sentiment: 5,
} as const satisfies Readonly<Record<ResearchFactor, number>>;

export const FUNDAMENTAL_FACTORS = [
  "quality",
  "valuation",
  "growthEstimateTrend",
  "balanceSheetStrength",
] as const satisfies readonly ResearchFactor[];

export interface FactorEvidence {
  score: number | null;
  confidence: number;
  sourceIds: string[];
  asOf: string | null;
  rationale?: string[];
}

export type ResearchFactors = Readonly<Record<ResearchFactor, FactorEvidence>>;

export interface WeightedResearchScore {
  total: number | null;
  contributions: Record<ResearchFactor, number | null>;
  nonSentimentContribution: number | null;
  sentimentContribution: number | null;
  fundamentalComposite: number | null;
  confidenceScore: number;
  confidence: ConfidenceLevel;
  validationReasons: GateReason[];
}

const FACTORS = Object.keys(
  RESEARCH_FACTOR_WEIGHTS,
) as ResearchFactor[];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function scoreIsValid(score: number | null): score is number {
  return (
    score !== null &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100
  );
}

function confidenceIsValid(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

export function calculateWeightedResearchScore(
  factors: ResearchFactors,
): WeightedResearchScore {
  const validationReasons: GateReason[] = [];
  const contributions = {} as Record<ResearchFactor, number | null>;
  let total = 0;
  let weightedConfidence = 0;

  for (const factor of FACTORS) {
    const evidence = factors[factor];
    const weight = RESEARCH_FACTOR_WEIGHTS[factor];
    if (!scoreIsValid(evidence.score)) {
      contributions[factor] = null;
      validationReasons.push({
        code: `invalid-${factor}-score`,
        message: `${factor} requires a score from 0 through 100.`,
      });
    } else {
      const contribution = (evidence.score * weight) / 100;
      contributions[factor] = round(contribution);
      total += contribution;
    }
    if (!confidenceIsValid(evidence.confidence)) {
      validationReasons.push({
        code: `invalid-${factor}-confidence`,
        message: `${factor} confidence must be from 0 through 1.`,
      });
    } else {
      weightedConfidence += evidence.confidence * (weight / 100);
    }
    if (!evidence.asOf) {
      validationReasons.push({
        code: `missing-${factor}-timestamp`,
        message: `${factor} is missing an evidence timestamp.`,
      });
    }
    if (evidence.sourceIds.length === 0) {
      validationReasons.push({
        code: `missing-${factor}-source`,
        message: `${factor} is missing a source reference.`,
      });
    }
  }

  const valid = validationReasons.length === 0;
  const fundamentalContribution = FUNDAMENTAL_FACTORS.reduce(
    (sum, factor) => sum + (contributions[factor] ?? 0),
    0,
  );
  const nonSentimentContribution = FACTORS.filter(
    (factor) => factor !== "sentiment",
  ).reduce((sum, factor) => sum + (contributions[factor] ?? 0), 0);
  const confidenceScore = round(weightedConfidence);
  const confidence: ConfidenceLevel =
    !valid || confidenceScore < 0.6
      ? "low"
      : confidenceScore < 0.8
        ? "medium"
        : "high";

  return {
    total: valid ? round(total) : null,
    contributions,
    nonSentimentContribution: valid
      ? round(nonSentimentContribution)
      : null,
    sentimentContribution: valid ? contributions.sentiment : null,
    fundamentalComposite: valid
      ? round((fundamentalContribution / 75) * 100)
      : null,
    confidenceScore,
    confidence,
    validationReasons,
  };
}

export type FundamentalGateStatus = "pass" | "caution" | "block";

export interface FundamentalGate extends GateAssessment {
  status: FundamentalGateStatus;
  composite: number | null;
}

export function assessFundamentals(
  score: WeightedResearchScore,
  criticalFlags: readonly string[] = [],
): FundamentalGate {
  const reasons: GateReason[] = criticalFlags.map((flag) => ({
    code: "critical-fundamental-flag",
    message: flag,
  }));

  if (score.fundamentalComposite === null) {
    reasons.push({
      code: "fundamental-score-unavailable",
      message: "A complete fundamental score is unavailable.",
    });
    return { status: "block", reasons, composite: null };
  }
  if (criticalFlags.length > 0 || score.fundamentalComposite < 45) {
    if (score.fundamentalComposite < 45) {
      reasons.push({
        code: "fundamentals-below-block-threshold",
        message: "The weighted fundamental composite is below 45.",
      });
    }
    return {
      status: "block",
      reasons,
      composite: score.fundamentalComposite,
    };
  }
  if (score.fundamentalComposite < 60) {
    reasons.push({
      code: "fundamentals-below-candidate-threshold",
      message: "The weighted fundamental composite is below 60.",
    });
    return {
      status: "caution",
      reasons,
      composite: score.fundamentalComposite,
    };
  }
  return {
    status: "pass",
    reasons,
    composite: score.fundamentalComposite,
  };
}

export type BearishEvidenceCategory =
  | ResearchFactor
  | "filing"
  | "corporate-event"
  | "portfolio-risk";

export interface BearishEvidence {
  category: BearishEvidenceCategory;
  sourceId: string;
  summary: string;
}

export function hasCorroboratingBearishEvidence(
  evidence: readonly BearishEvidence[],
): boolean {
  const nonSentiment = evidence.filter(
    (item) => item.category !== "sentiment",
  );
  return (
    new Set(nonSentiment.map((item) => item.category)).size >= 2 &&
    new Set(nonSentiment.map((item) => item.sourceId)).size >= 2
  );
}

export type ResearchAction =
  | "consider-candidate"
  | "watch"
  | "hold"
  | "review"
  | "avoid"
  | "exit-candidate"
  | "insufficient-data";

export const RESEARCH_ACTION_LABELS = {
  "consider-candidate": "Consider candidate",
  watch: "Watch",
  hold: "Hold",
  review: "Review",
  avoid: "Avoid",
  "exit-candidate": "Exit candidate",
  "insufficient-data": "Insufficient data",
} as const satisfies Readonly<Record<ResearchAction, string>>;

export interface ResearchDecisionInput {
  factors: ResearchFactors;
  owned: boolean;
  evidenceGate: GateAssessment;
  universeGate: GateAssessment;
  portfolioRiskGate: GateAssessment;
  criticalFundamentalFlags?: readonly string[];
  bearishEvidence?: readonly BearishEvidence[];
  operationalReadiness?: OperationalReadiness;
}

export interface ResearchDecision {
  action: ResearchAction;
  label: (typeof RESEARCH_ACTION_LABELS)[ResearchAction];
  score: WeightedResearchScore;
  fundamentalGate: FundamentalGate;
  liveLabelEligible: boolean;
  requiresManualConfirmation: true;
  reasons: GateReason[];
}

function basePositiveAction(owned: boolean): ResearchAction {
  return owned ? "hold" : "watch";
}

function reason(
  code: string,
  message: string,
): GateReason {
  return { code, message };
}

function gatePassed(status: GateStatus): boolean {
  return status === "pass";
}

export function decideResearchAction(
  input: ResearchDecisionInput,
): ResearchDecision {
  const score = calculateWeightedResearchScore(input.factors);
  const fundamentalGate = assessFundamentals(
    score,
    input.criticalFundamentalFlags,
  );
  const reasons: GateReason[] = [
    ...score.validationReasons,
    ...fundamentalGate.reasons,
  ];
  let action: ResearchAction;

  if (score.total === null || !gatePassed(input.evidenceGate.status)) {
    action = "insufficient-data";
    reasons.push(...input.evidenceGate.reasons);
  } else if (!gatePassed(input.universeGate.status)) {
    action = input.owned ? "review" : "avoid";
    reasons.push(...input.universeGate.reasons);
  } else if (input.portfolioRiskGate.status === "block") {
    action = "review";
    reasons.push(...input.portfolioRiskGate.reasons);
    reasons.push(
      reason(
        "portfolio-risk-blocks-score",
        "Portfolio risk blocks an upgrade regardless of sentiment or total score.",
      ),
    );
  } else if (
    score.total >= 75 &&
    score.confidence === "high" &&
    fundamentalGate.status === "pass" &&
    gatePassed(input.portfolioRiskGate.status)
  ) {
    action = "consider-candidate";
  } else if (score.total >= 60) {
    action =
      fundamentalGate.status === "block"
        ? "review"
        : basePositiveAction(input.owned);
    if (score.total >= 75 && score.confidence !== "high") {
      reasons.push(
        reason(
          "high-confidence-required",
          "A score of 75 or more remains Watch/Hold until confidence is high.",
        ),
      );
    }
    if (
      score.total >= 75 &&
      fundamentalGate.status !== "pass"
    ) {
      reasons.push(
        reason(
          "fundamentals-block-candidate",
          "Fundamentals prevent a candidate label regardless of sentiment.",
        ),
      );
    }
    if (input.portfolioRiskGate.status === "caution") {
      reasons.push(...input.portfolioRiskGate.reasons);
      reasons.push(
        reason(
          "portfolio-risk-caps-action",
          "Portfolio risk caps the result at Watch/Hold.",
        ),
      );
    }
  } else if (score.total >= 45) {
    action = "review";
  } else if (
    hasCorroboratingBearishEvidence(input.bearishEvidence ?? [])
  ) {
    action = input.owned ? "exit-candidate" : "avoid";
  } else {
    action = "review";
    reasons.push(
      reason(
        "bearish-corroboration-required",
        "A sub-45 score needs two independent non-sentiment evidence categories before Avoid/Exit candidate.",
      ),
    );
  }

  const liveLabelEligible =
    action !== "insufficient-data" &&
    input.operationalReadiness?.canUseLiveActionLabels === true;

  return {
    action,
    label: RESEARCH_ACTION_LABELS[action],
    score,
    fundamentalGate,
    liveLabelEligible,
    requiresManualConfirmation: true,
    reasons: [...new Map(reasons.map((item) => [item.code, item])).values()],
  };
}
