import { requireApiOwner } from "@/lib/api-context";
import { errorResponse } from "@/lib/http";
import { getPaperPerformance } from "@/lib/paper";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({
      paper: await getPaperPerformance(auth.ownerEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
