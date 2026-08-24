import type {
  GateAssessment,
  GateReason,
  ResearchProviderProfile,
} from "./types";

const REQUIRED_CALENDAR_DAYS = 30;
const REQUIRED_MARKET_SESSIONS = 20;
const REQUIRED_RUN_RELIABILITY = 0.95;

export interface PaperTrialRecord {
  startedOn: string | null;
  completedMarketSessions: number;
  scheduledRuns: number;
  successfulRuns: number;
  reconciliationPassed: boolean;
  unresolvedDataQualityFailures: number;
}

export type ConfidenceLevel = "low" | "medium" | "high";

export interface OperationalReadinessInput {
  provider: ResearchProviderProfile;
  evaluationDate: string;
  paperTrial: PaperTrialRecord;
  quoteEntitlementVerified: boolean;
  explicitUserAcknowledgementAt: string | null;
  confidence: ConfidenceLevel;
  evidenceGate: GateAssessment;
  universeGate: GateAssessment;
  portfolioRiskGate: GateAssessment;
}

export type ResearchDisplayMode =
  | "trial-research"
  | "paper-trial"
  | "live-data-research";

export interface OperationalReadiness {
  displayMode: ResearchDisplayMode;
  displayLabel: "Research only" | "Paper trial" | "Live-data research";
  canUseLiveActionLabels: boolean;
  autoTradingAllowed: false;
  requiresManualOrderConfirmation: true;
  blockers: GateReason[];
  metrics: {
    calendarDays: number;
    completedMarketSessions: number;
    scheduledRunReliability: number;
  };
}

function utcDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = Date.UTC(year, month - 1, day);
  return Number.isFinite(result) ? result : null;
}

export function calendarDayDifference(
  startedOn: string | null,
  evaluationDate: string,
): number {
  if (!startedOn) return 0;
  const start = utcDay(startedOn);
  const end = utcDay(evaluationDate);
  if (start === null || end === null || end < start) {
    return 0;
  }
  return Math.floor((end - start) / (24 * 60 * 60 * 1_000));
}

export function evaluateOperationalReadiness(
  input: OperationalReadinessInput,
): OperationalReadiness {
  const blockers: GateReason[] = [];
  const calendarDays = calendarDayDifference(
    input.paperTrial.startedOn,
    input.evaluationDate,
  );
  const countsAreValid =
    input.paperTrial.scheduledRuns >= 0 &&
    input.paperTrial.successfulRuns >= 0 &&
    input.paperTrial.successfulRuns <= input.paperTrial.scheduledRuns &&
    input.paperTrial.completedMarketSessions >= 0;
  const reliability =
    input.paperTrial.scheduledRuns > 0 && countsAreValid
      ? input.paperTrial.successfulRuns / input.paperTrial.scheduledRuns
      : 0;

  if (!input.paperTrial.startedOn) {
    blockers.push({
      code: "paper-trial-not-started",
      message:
        "Start the paper trial explicitly in Settings after onboarding and ledger reconciliation.",
    });
  }

  if (!input.provider.isFullDataProvider || input.provider.mode !== "full") {
    blockers.push({
      code: "full-provider-required",
      message: "Live-data labels require the configured full-data provider.",
    });
  }
  if (!input.quoteEntitlementVerified) {
    blockers.push({
      code: "quote-entitlement-unverified",
      message:
        "The provider's Canadian quote freshness and entitlement have not been verified.",
    });
  }
  if (calendarDays < REQUIRED_CALENDAR_DAYS) {
    blockers.push({
      code: "paper-trial-days-incomplete",
      message: `Complete at least ${REQUIRED_CALENDAR_DAYS} calendar days of paper trial.`,
    });
  }
  if (
    input.paperTrial.completedMarketSessions < REQUIRED_MARKET_SESSIONS
  ) {
    blockers.push({
      code: "paper-trial-sessions-incomplete",
      message: `Complete at least ${REQUIRED_MARKET_SESSIONS} market sessions.`,
    });
  }
  if (!countsAreValid) {
    blockers.push({
      code: "paper-trial-counts-invalid",
      message: "Paper-trial run counts are inconsistent.",
    });
  } else if (reliability < REQUIRED_RUN_RELIABILITY) {
    blockers.push({
      code: "paper-trial-reliability-low",
      message: "Scheduled-run reliability must be at least 95%.",
    });
  }
  if (!input.paperTrial.reconciliationPassed) {
    blockers.push({
      code: "reconciliation-required",
      message: "Paper-trial results must pass reconciliation.",
    });
  }
  if (input.paperTrial.unresolvedDataQualityFailures > 0) {
    blockers.push({
      code: "unresolved-data-quality-failures",
      message: "Resolve every data-quality failure before enabling live labels.",
    });
  }
  if (
    !input.explicitUserAcknowledgementAt ||
    !Number.isFinite(Date.parse(input.explicitUserAcknowledgementAt))
  ) {
    blockers.push({
      code: "user-acknowledgement-required",
      message:
        "The user must explicitly acknowledge that labels are research, not guaranteed advice.",
    });
  }
  if (input.confidence !== "high") {
    blockers.push({
      code: "high-confidence-required",
      message: "Live action labels require high-confidence evidence.",
    });
  }

  for (const [name, gate] of [
    ["evidence", input.evidenceGate],
    ["universe", input.universeGate],
    ["portfolio-risk", input.portfolioRiskGate],
  ] as const) {
    if (gate.status !== "pass") {
      blockers.push({
        code: `${name}-gate-not-passed`,
        message: `The ${name} gate must pass before enabling live labels.`,
      });
      blockers.push(...gate.reasons);
    }
  }

  const canUseLiveActionLabels = blockers.length === 0;
  const displayMode: ResearchDisplayMode = canUseLiveActionLabels
    ? "live-data-research"
    : input.provider.isFullDataProvider
      ? "paper-trial"
      : "trial-research";

  return {
    displayMode,
    displayLabel:
      displayMode === "live-data-research"
        ? "Live-data research"
        : displayMode === "paper-trial"
          ? "Paper trial"
          : "Research only",
    canUseLiveActionLabels,
    autoTradingAllowed: false,
    requiresManualOrderConfirmation: true,
    blockers,
    metrics: {
      calendarDays,
      completedMarketSessions: input.paperTrial.completedMarketSessions,
      scheduledRunReliability: reliability,
    },
  };
}

export const LIVE_LABEL_REQUIREMENTS = {
  calendarDays: REQUIRED_CALENDAR_DAYS,
  marketSessions: REQUIRED_MARKET_SESSIONS,
  scheduledRunReliability: REQUIRED_RUN_RELIABILITY,
} as const;
