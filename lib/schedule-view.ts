import {
  CALGARY_TIME_ZONE,
  calgaryParts,
  zonedLocalToUtc,
  type ResearchSlot,
} from "./calgary-time";

export type ScheduledRunView = {
  slot: ResearchSlot;
  label: string;
  at: string;
};

export function nextScheduledRuns(
  now = new Date(),
  count = 2,
): ScheduledRunView[] {
  const local = calgaryParts(now);
  const localAnchor = new Date(
    Date.UTC(local.year, local.month - 1, local.day),
  );
  const candidates: ScheduledRunView[] = [];
  for (let offset = 0; offset < 10 && candidates.length < count; offset += 1) {
    const date = new Date(localAnchor.getTime() + offset * 86_400_000);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const slot of ["morning", "evening"] as const) {
      const hour = slot === "morning" ? 7 : 17;
      const at = zonedLocalToUtc(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        30,
      );
      if (at.getTime() <= now.getTime()) continue;
      candidates.push({
        slot,
        label: slot === "morning" ? "Morning brief" : "Evening review",
        at: at.toISOString(),
      });
      if (candidates.length >= count) break;
    }
  }
  return candidates;
}

export const scheduleTimeZone = CALGARY_TIME_ZONE;
