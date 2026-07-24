import { requireApiOwner } from "@/lib/api-context";
import { slotForCalgaryTime } from "@/lib/calgary-time";
import { errorResponse, readJson } from "@/lib/http";
import { newId } from "@/lib/ids";
import { executeResearchRun } from "@/lib/research-runner";

export async function POST(request: Request) {
  const auth = requireApiOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const payload = await readJson<{ slot?: "morning" | "evening" }>(request);
    const slot =
      payload.slot === "morning" || payload.slot === "evening"
        ? payload.slot
        : slotForCalgaryTime();
    const result = await executeResearchRun({
      ownerEmail: auth.ownerEmail,
      slot,
      idempotencyKey: `manual:${newId("rerun")}`,
      trigger: "manual",
    });
    return Response.json({ run: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
