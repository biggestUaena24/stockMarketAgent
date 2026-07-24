import type { CacheState, GateAssessment, GateReason } from "./types";

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type EvidenceKind =
  | "quote"
  | "company-profile"
  | "fundamentals"
  | "analyst-estimates"
  | "news"
  | "sentiment"
  | "corporate-events"
  | "portfolio"
  | "fx";

export interface ResearchArtifact {
  id: string;
  kind: EvidenceKind;
  source: string;
  asOf: string;
  fetchedAt: string;
  cacheState?: CacheState;
  critical?: boolean;
}

export interface FreshnessPolicy {
  maxAgeMs: Readonly<Record<EvidenceKind, number>>;
  requiredKinds: readonly EvidenceKind[];
  futureToleranceMs: number;
}

export const TRIAL_RESEARCH_FRESHNESS_POLICY = {
  maxAgeMs: {
    quote: 36 * HOUR,
    "company-profile": 30 * DAY,
    fundamentals: 150 * DAY,
    "analyst-estimates": 45 * DAY,
    news: 72 * HOUR,
    sentiment: 48 * HOUR,
    "corporate-events": 30 * DAY,
    portfolio: 24 * HOUR,
    fx: 24 * HOUR,
  },
  requiredKinds: ["quote", "fundamentals", "news", "portfolio"],
  futureToleranceMs: 10 * MINUTE,
} as const satisfies FreshnessPolicy;

export const FULL_RESEARCH_FRESHNESS_POLICY = {
  ...TRIAL_RESEARCH_FRESHNESS_POLICY,
  maxAgeMs: {
    ...TRIAL_RESEARCH_FRESHNESS_POLICY.maxAgeMs,
    quote: 20 * MINUTE,
  },
} as const satisfies FreshnessPolicy;

export const LIVE_LABEL_FRESHNESS_POLICY = {
  ...FULL_RESEARCH_FRESHNESS_POLICY,
  maxAgeMs: {
    ...FULL_RESEARCH_FRESHNESS_POLICY.maxAgeMs,
    quote: 5 * MINUTE,
    portfolio: 30 * MINUTE,
    fx: 60 * MINUTE,
  },
} as const satisfies FreshnessPolicy;

export interface FreshnessAssessment extends GateAssessment {
  staleArtifactIds: string[];
  missingKinds: EvidenceKind[];
  newestAsOfByKind: Partial<Record<EvidenceKind, string>>;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessFreshness(
  artifacts: readonly ResearchArtifact[],
  now: Date,
  policy: FreshnessPolicy,
): FreshnessAssessment {
  const reasons: GateReason[] = [];
  const staleArtifactIds: string[] = [];
  const newestAsOfByKind: Partial<Record<EvidenceKind, string>> = {};
  const grouped = new Map<EvidenceKind, ResearchArtifact[]>();

  for (const artifact of artifacts) {
    const group = grouped.get(artifact.kind) ?? [];
    group.push(artifact);
    grouped.set(artifact.kind, group);
  }

  const missingKinds = policy.requiredKinds.filter(
    (kind) => !grouped.has(kind),
  );
  for (const kind of missingKinds) {
    reasons.push({
      code: `missing-${kind}`,
      message: `Required ${kind} evidence is missing.`,
    });
  }

  for (const [kind, candidates] of grouped) {
    const sorted = [...candidates].sort(
      (left, right) =>
        (timestamp(right.asOf) ?? Number.NEGATIVE_INFINITY) -
        (timestamp(left.asOf) ?? Number.NEGATIVE_INFINITY),
    );
    const newest = sorted[0];
    if (!newest) {
      continue;
    }
    newestAsOfByKind[kind] = newest.asOf;
    const asOf = timestamp(newest.asOf);
    const fetchedAt = timestamp(newest.fetchedAt);

    if (asOf === null || fetchedAt === null) {
      staleArtifactIds.push(newest.id);
      reasons.push({
        code: `invalid-${kind}-timestamp`,
        message: `${kind} evidence has an invalid timestamp.`,
      });
      continue;
    }
    if (asOf - now.getTime() > policy.futureToleranceMs) {
      staleArtifactIds.push(newest.id);
      reasons.push({
        code: `future-${kind}-timestamp`,
        message: `${kind} evidence is dated unexpectedly in the future.`,
      });
    }
    if (now.getTime() - asOf > policy.maxAgeMs[kind]) {
      staleArtifactIds.push(newest.id);
      reasons.push({
        code: `stale-${kind}`,
        message: `${kind} evidence is older than the allowed freshness window.`,
      });
    }
    if (newest.cacheState === "stale-fallback") {
      staleArtifactIds.push(newest.id);
      reasons.push({
        code: `stale-cache-${kind}`,
        message: `${kind} evidence came from an expired cache fallback.`,
      });
    }
  }

  return {
    status:
      missingKinds.length > 0 || staleArtifactIds.length > 0 ? "block" : "pass",
    reasons,
    staleArtifactIds: [...new Set(staleArtifactIds)],
    missingKinds,
    newestAsOfByKind,
  };
}

export type ConflictValue = number | string | boolean | null;

export interface ConflictObservation {
  field: string;
  source: string;
  value: ConflictValue;
  asOf: string;
}

export interface FieldTolerance {
  relative?: number;
  absolute?: number;
}

export interface ConflictPolicy {
  defaultRelativeTolerance: number;
  defaultAbsoluteTolerance: number;
  fieldTolerances?: Readonly<Record<string, FieldTolerance>>;
}

export interface DataConflict {
  field: string;
  sources: string[];
  values: ConflictValue[];
  message: string;
}

export interface ConflictAssessment extends GateAssessment {
  conflicts: DataConflict[];
}

export const DEFAULT_CONFLICT_POLICY = {
  defaultRelativeTolerance: 0.02,
  defaultAbsoluteTolerance: 0.01,
  fieldTolerances: {
    price: { relative: 0.01, absolute: 0.02 },
    marketCap: { relative: 0.05, absolute: 1 },
    sharesOutstanding: { relative: 0.02, absolute: 1 },
  },
} as const satisfies ConflictPolicy;

function valuesConflict(
  left: Exclude<ConflictValue, null>,
  right: Exclude<ConflictValue, null>,
  tolerance: Required<FieldTolerance>,
): boolean {
  if (typeof left === "number" && typeof right === "number") {
    const difference = Math.abs(left - right);
    const scale = Math.max(Math.abs(left), Math.abs(right), 1);
    return (
      difference > tolerance.absolute &&
      difference / scale > tolerance.relative
    );
  }
  return String(left).trim().toLowerCase() !== String(right).trim().toLowerCase();
}

export function assessConflicts(
  observations: readonly ConflictObservation[],
  policy: ConflictPolicy = DEFAULT_CONFLICT_POLICY,
): ConflictAssessment {
  const groups = new Map<string, Map<string, ConflictObservation>>();
  for (const observation of observations) {
    if (observation.value === null) {
      continue;
    }
    const sources = groups.get(observation.field) ?? new Map();
    const existing = sources.get(observation.source);
    if (
      !existing ||
      (timestamp(observation.asOf) ?? 0) >= (timestamp(existing.asOf) ?? 0)
    ) {
      sources.set(observation.source, observation);
    }
    groups.set(observation.field, sources);
  }

  const conflicts: DataConflict[] = [];
  for (const [field, bySource] of groups) {
    const values = [...bySource.values()];
    if (values.length < 2) {
      continue;
    }
    const configured = policy.fieldTolerances?.[field] ?? {};
    const tolerance = {
      relative: configured.relative ?? policy.defaultRelativeTolerance,
      absolute: configured.absolute ?? policy.defaultAbsoluteTolerance,
    };
    const baseline = values[0];
    const hasConflict = values
      .slice(1)
      .some((candidate) =>
        valuesConflict(
          baseline.value as Exclude<ConflictValue, null>,
          candidate.value as Exclude<ConflictValue, null>,
          tolerance,
        ),
      );
    if (hasConflict) {
      conflicts.push({
        field,
        sources: values.map((item) => item.source),
        values: values.map((item) => item.value),
        message: `Sources disagree on ${field} beyond the configured tolerance.`,
      });
    }
  }

  return {
    status: conflicts.length > 0 ? "block" : "pass",
    reasons: conflicts.map((conflict) => ({
      code: `conflict-${conflict.field}`,
      message: conflict.message,
    })),
    conflicts,
  };
}

export interface EvidenceQualityAssessment extends GateAssessment {
  freshness: FreshnessAssessment;
  conflicts: ConflictAssessment;
}

export function assessEvidenceQuality(
  artifacts: readonly ResearchArtifact[],
  observations: readonly ConflictObservation[],
  now: Date,
  freshnessPolicy: FreshnessPolicy,
  conflictPolicy: ConflictPolicy = DEFAULT_CONFLICT_POLICY,
): EvidenceQualityAssessment {
  const freshness = assessFreshness(artifacts, now, freshnessPolicy);
  const conflicts = assessConflicts(observations, conflictPolicy);
  const reasons = [...freshness.reasons, ...conflicts.reasons];

  return {
    status:
      freshness.status === "block" || conflicts.status === "block"
        ? "block"
        : reasons.length > 0
          ? "caution"
          : "pass",
    reasons,
    freshness,
    conflicts,
  };
}
