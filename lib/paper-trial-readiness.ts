import { and, asc, eq, gte, or, like } from "drizzle-orm";
import { getReadyDb } from "@/db";
import { researchRuns } from "@/db/schema";
import {
  summarizePaperTrialReadiness,
  type PaperTrialReadiness,
} from "@/lib/research/run-accounting";

export type { PaperTrialReadiness } from "@/lib/research/run-accounting";

export async function getPaperTrialReadiness(
  ownerEmail: string,
  paperTrialStartedAt: string | null,
): Promise<PaperTrialReadiness> {
  if (!paperTrialStartedAt || !Number.isFinite(Date.parse(paperTrialStartedAt))) {
    return summarizePaperTrialReadiness([], null);
  }

  const db = await getReadyDb();
  const rows = await db
    .select({
      idempotencyKey: researchRuns.idempotencyKey,
      actualTime: researchRuns.actualTime,
      status: researchRuns.status,
      dataFreshness: researchRuns.dataFreshness,
      errorsJson: researchRuns.errorsJson,
      marketStateJson: researchRuns.marketStateJson,
    })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.ownerEmail, ownerEmail),
        gte(researchRuns.actualTime, paperTrialStartedAt),
        or(
          like(researchRuns.idempotencyKey, "%:morning"),
          like(researchRuns.idempotencyKey, "%:evening"),
        ),
      ),
    )
    .orderBy(asc(researchRuns.actualTime));

  return summarizePaperTrialReadiness(rows, paperTrialStartedAt);
}
