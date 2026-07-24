import { isValidMachineToken } from "@/lib/auth";
import {
  calgaryDateKey,
  scheduledIdempotencyKey,
  scheduledTimeUtc,
  slotForCalgaryTime,
  type ResearchSlot,
} from "@/lib/calgary-time";
import { errorResponse, readJson } from "@/lib/http";
import { executeResearchRun } from "@/lib/research-runner";
import { getRuntimeEnv } from "@/lib/runtime-env";

export async function POST(request: Request) {
  if (!isValidMachineToken(request)) {
    return Response.json({ error: "Invalid scheduler token." }, { status: 401 });
  }
  try {
    const payload = await readJson<{ slot?: ResearchSlot }>(request);
    const now = new Date();
    const slot =
      payload.slot === "morning" || payload.slot === "evening"
        ? payload.slot
        : slotForCalgaryTime(now);
    const ownerEmail = getRuntimeEnv("OWNER_EMAIL");
    if (!ownerEmail) {
      return Response.json(
        { error: "OWNER_EMAIL is not configured." },
        { status: 503 },
      );
    }
    const result = await executeResearchRun({
      ownerEmail,
      slot,
      idempotencyKey: scheduledIdempotencyKey(now, slot),
      scheduledTime: scheduledTimeUtc(now, slot),
      trigger: "scheduled",
    });
    return Response.json({
      run: result,
      localDate: calgaryDateKey(now),
      slot,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
