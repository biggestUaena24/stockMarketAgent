import { canonicalOwnerStorageKey, normalizeEmail } from "./auth-policy";

const OWNER_SCOPED_TABLES = [
  "owner_settings",
  "transactions",
  "import_batches",
  "research_runs",
  "evidence",
  "recommendations",
  "paper_trades",
  "paper_marks",
  "paper_benchmark_marks",
  "notification_deliveries",
] as const;

export type OwnerStorageRekeyPlan =
  | { status: "none" }
  | { status: "rekey"; fromEmail: string; toEmail: string }
  | { status: "conflict" };

export function planOwnerStorageRekey(
  configuredOwnerEmail: string,
  discoveredOwnerEmails: readonly string[],
): OwnerStorageRekeyPlan {
  const canonical = canonicalOwnerStorageKey(configuredOwnerEmail);
  if (!canonical) return { status: "conflict" };

  const matchingKeys = Array.from(
    new Set(
      discoveredOwnerEmails.filter(
        (email) => normalizeEmail(email) === canonical,
      ),
    ),
  );
  if (matchingKeys.length === 0) return { status: "none" };
  if (matchingKeys.length > 1) return { status: "conflict" };
  if (matchingKeys[0] === canonical) return { status: "none" };
  return {
    status: "rekey",
    fromEmail: matchingKeys[0]!,
    toEmail: canonical,
  };
}

/**
 * Rekeys the one unambiguous legacy email-casing variant to the canonical
 * OWNER_EMAIL key. If records already span more than one variant, stop rather
 * than guessing how to merge settings or owner-scoped unique records.
 */
export async function ensureCanonicalOwnerStorage(
  d1: D1Database,
  configuredOwnerEmail: string,
): Promise<void> {
  const canonical = canonicalOwnerStorageKey(configuredOwnerEmail);
  if (!canonical) {
    throw new Error("OWNER_EMAIL cannot be normalized to a storage key.");
  }

  // Keep these as independent bounded reads. Combining every owner table into
  // one UNION can exceed the compound-select limit on the hosted D1 runtime.
  const discoveredOwnerEmails: string[] = [];
  for (const table of OWNER_SCOPED_TABLES) {
    const result = await d1
      .prepare(`SELECT DISTINCT owner_email AS ownerEmail FROM ${table}`)
      .all<{ ownerEmail: string }>();
    discoveredOwnerEmails.push(...result.results.map((row) => row.ownerEmail));
  }
  const plan = planOwnerStorageRekey(
    canonical,
    discoveredOwnerEmails,
  );

  if (plan.status === "none") return;
  if (plan.status === "conflict") {
    throw new Error(
      "Owner records exist under multiple email-casing variants. Automatic normalization stopped to avoid an unsafe data merge.",
    );
  }

  try {
    await d1.batch(
      OWNER_SCOPED_TABLES.map((table) =>
        d1
          .prepare(`UPDATE ${table} SET owner_email = ? WHERE owner_email = ?`)
          .bind(plan.toEmail, plan.fromEmail),
      ),
    );
  } catch (error) {
    throw new Error(
      "Existing owner records could not be normalized safely; the owner data was not intentionally merged.",
      { cause: error },
    );
  }
}
