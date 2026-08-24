import { requireApiOwner } from "@/lib/api-context";
import { errorResponse } from "@/lib/http";
import { getPaperPerformance } from "@/lib/paper";
import { getPaperTrialReadiness } from "@/lib/paper-trial-readiness";
import { getOrCreateSettings } from "@/lib/settings";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const settings = await getOrCreateSettings(auth.ownerEmail);
    const [paper, readiness] = await Promise.all([
      getPaperPerformance(auth.ownerEmail),
      getPaperTrialReadiness(
        auth.ownerEmail,
        settings.paperTrialStartedAt,
      ),
    ]);
    return Response.json({
      paper,
      readiness,
      settings,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
