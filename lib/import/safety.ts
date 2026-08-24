import type {
  ImportIssue,
  NormalizedWealthsimpleRecord,
  WealthsimpleImportKind,
} from "./types";

export interface LedgerImportValues {
  action: string;
  canonicalSymbol: string;
  exchange: string;
  quantity: number;
  price: number;
  currency: string;
  fee: number;
  fxRateToCad: number;
  occurredAt: string;
}

export interface ExistingLedgerEntry extends LedgerImportValues {
  importId?: string | null;
  notes?: string | null;
}

export interface LedgerImportCandidate {
  record: NormalizedWealthsimpleRecord;
  values: LedgerImportValues | null;
}

export interface ImportSafetyAssessment {
  globalIssues: ImportIssue[];
  issuesByRow: Map<number, ImportIssue[]>;
}

const HOLDINGS_NOTE = "Opening position from Wealthsimple holdings CSV";

/**
 * Protects the append-only ledger from baseline and cross-source duplication.
 * Exact Wealthsimple import identities are handled by the CSV normalizer; this
 * layer catches overlaps that cannot share an import ID, such as a later
 * holdings snapshot or a trade that was previously entered manually.
 */
export function assessImportSafety(
  kind: WealthsimpleImportKind | undefined,
  candidates: readonly LedgerImportCandidate[],
  existing: readonly ExistingLedgerEntry[],
): ImportSafetyAssessment {
  const globalIssues: ImportIssue[] = [];
  const issuesByRow = new Map<number, ImportIssue[]>();
  const addRowIssue = (rowNumber: number, code: string, message: string) => {
    const current = issuesByRow.get(rowNumber) ?? [];
    current.push({
      severity: "error",
      code,
      message,
      rowNumber,
    });
    issuesByRow.set(rowNumber, current);
  };

  const openingRows = existing.filter(isHoldingsOpeningRow);
  const existingSecurityTrades = existing.filter(
    (entry) =>
      entry.canonicalSymbol !== "CASH" &&
      (entry.action === "BUY" || entry.action === "SELL"),
  );

  if (kind === "holdings" && candidates.length > 0) {
    if (openingRows.length > 0) {
      globalIssues.push({
        severity: "error",
        code: "HOLDINGS_SNAPSHOT_ALREADY_EXISTS",
        message:
          "A holdings snapshot is already represented in the ledger. Adding another snapshot would repeat opening BUY rows. Keep the existing baseline and import only later activity, or remove and rebuild the old baseline first.",
        rowNumber: 0,
      });
    } else if (existingSecurityTrades.length > 0) {
      globalIssues.push({
        severity: "error",
        code: "HOLDINGS_SNAPSHOT_OVERLAPS_LEDGER",
        message:
          "The ledger already contains security trades. A holdings snapshot could overlap those trades and double-count positions. Use a holdings snapshot only as the first security baseline, or continue with activity imports.",
        rowNumber: 0,
      });
    }
  }

  const baselineDates = openingRows
    .map((entry) => dateOnly(entry.occurredAt))
    .filter(Boolean)
    .sort();
  const latestBaselineDate = baselineDates.at(-1);

  for (const candidate of candidates) {
    if (
      kind === "activities" &&
      latestBaselineDate &&
      candidate.record.kind === "activity" &&
      dateOnly(candidate.record.date) <= latestBaselineDate
    ) {
      addRowIssue(
        candidate.record.rowNumber,
        "ACTIVITY_OVERLAPS_HOLDINGS_BASELINE",
        `This activity is dated on or before the existing holdings baseline (${latestBaselineDate}). Import only activity after that date so the opening positions are not counted twice.`,
      );
    }

    if (
      candidate.values &&
      existing.some((entry) => sameLedgerEffect(entry, candidate.values!))
    ) {
      addRowIssue(
        candidate.record.rowNumber,
        "POSSIBLE_LEDGER_DUPLICATE",
        "An existing manual or imported ledger row has the same date, action, security, quantity, price, currency, fee, and FX rate. Keep one source of truth for this activity.",
      );
    }
  }

  return { globalIssues, issuesByRow };
}

function isHoldingsOpeningRow(entry: ExistingLedgerEntry): boolean {
  return (
    entry.importId?.startsWith("wsh_") === true ||
    entry.notes === HOLDINGS_NOTE
  );
}

function sameLedgerEffect(
  left: ExistingLedgerEntry,
  right: LedgerImportValues,
): boolean {
  return (
    left.action === right.action &&
    left.canonicalSymbol === right.canonicalSymbol &&
    left.exchange === right.exchange &&
    left.currency === right.currency &&
    dateOnly(left.occurredAt) === dateOnly(right.occurredAt) &&
    nearlyEqual(left.quantity, right.quantity) &&
    nearlyEqual(left.price, right.price) &&
    nearlyEqual(left.fee, right.fee) &&
    nearlyEqual(left.fxRateToCad, right.fxRateToCad)
  );
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8;
}
