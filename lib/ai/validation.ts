export type ExplanationPayload = {
  summary: string;
  thesis: string;
  contrary_evidence: Array<{ text: string; evidence_ids: string[] }>;
  catalysts: Array<{ text: string; evidence_ids: string[] }>;
  risks: Array<{ text: string; evidence_ids: string[] }>;
  invalidation_conditions: Array<{
    text: string;
    evidence_ids: string[];
  }>;
  citation_evidence_ids: string[];
};

export function validateExplanation(
  explanation: ExplanationPayload,
  allowedIds: Set<string>,
): void {
  const citedGroups = [
    ...explanation.contrary_evidence,
    ...explanation.catalysts,
    ...explanation.risks,
    ...explanation.invalidation_conditions,
  ];
  for (const group of citedGroups) {
    if (group.evidence_ids.length === 0) {
      throw new Error("Every research explanation item requires a citation.");
    }
    if (group.evidence_ids.some((id) => !allowedIds.has(id))) {
      throw new Error("The research explanation cited unknown evidence.");
    }
  }
  if (
    explanation.citation_evidence_ids.some((id) => !allowedIds.has(id)) ||
    explanation.citation_evidence_ids.length === 0
  ) {
    throw new Error("The research explanation has invalid citations.");
  }
  const prose = [
    explanation.summary,
    explanation.thesis,
    ...citedGroups.map((group) => group.text),
  ].join(" ");
  if (/\d/.test(prose)) {
    throw new Error(
      "The model introduced a numeric claim; the explanation was rejected.",
    );
  }
}

export function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}
