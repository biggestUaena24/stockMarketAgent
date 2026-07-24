import { requireApiOwner } from "@/lib/api-context";
import { ApiError, errorResponse } from "@/lib/http";
import { latestResearchForSymbol } from "@/lib/reports";
import { canonicalizeSymbol } from "@/lib/transactions";

export async function GET(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const symbol = canonicalizeSymbol(
      new URL(request.url).searchParams.get("symbol") ?? "",
    );
    const research = await latestResearchForSymbol(auth.ownerEmail, symbol);
    if (!research) {
      throw new ApiError(
        "No saved research exists for this symbol.",
        404,
        "NOT_FOUND",
      );
    }
    return Response.json({ research });
  } catch (error) {
    return errorResponse(error);
  }
}
