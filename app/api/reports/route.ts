import { requireApiOwner } from "@/lib/api-context";
import { errorResponse } from "@/lib/http";
import { listResearchRuns } from "@/lib/reports";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 30);
    return Response.json({
      reports: await listResearchRuns(auth.ownerEmail, limit),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
