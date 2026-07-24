import { requireApiOwner } from "@/lib/api-context";
import { errorResponse } from "@/lib/http";
import { buildPortfolioView } from "@/lib/portfolio-view";
import { listResearchRuns } from "@/lib/reports";
import { nextScheduledRuns, scheduleTimeZone } from "@/lib/schedule-view";
import { getOrCreateSettings } from "@/lib/settings";
import { listTransactions } from "@/lib/transactions";
import { hasRuntimeEnv } from "@/lib/runtime-env";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const [settings, transactions, reports] = await Promise.all([
      getOrCreateSettings(auth.ownerEmail),
      listTransactions(auth.ownerEmail, 2_000),
      listResearchRuns(auth.ownerEmail, 5),
    ]);
    const portfolio = buildPortfolioView(transactions, settings);
    return Response.json({
      settings,
      portfolio,
      reports,
      schedule: {
        timeZone: scheduleTimeZone,
        nextRuns: nextScheduledRuns(),
      },
      configuration: {
        alphaVantage: hasRuntimeEnv("ALPHA_VANTAGE_API_KEY"),
        fmp: hasRuntimeEnv("FMP_API_KEY"),
        openai: hasRuntimeEnv("OPENAI_API_KEY"),
        resend: hasRuntimeEnv("RESEND_API_KEY"),
        notificationEmail: hasRuntimeEnv("NOTIFICATION_EMAIL"),
        schedulerSecret: hasRuntimeEnv("SCHEDULER_SECRET"),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
