export const CALGARY_TIME_ZONE = "America/Edmonton";
export type ResearchSlot = "morning" | "evening";

export type CalgaryDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export function calgaryParts(date = new Date()): CalgaryDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CALGARY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: value("weekday"),
  };
}

export function calgaryDateKey(date = new Date()): string {
  const parts = calgaryParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function slotForCalgaryTime(date = new Date()): ResearchSlot {
  return calgaryParts(date).hour < 12 ? "morning" : "evening";
}

export function scheduledIdempotencyKey(
  date: Date,
  slot: ResearchSlot,
): string {
  return `${calgaryDateKey(date)}:${slot}`;
}

export function scheduledTimeUtc(
  date: Date,
  slot: ResearchSlot,
): string {
  const local = calgaryParts(date);
  const hour = slot === "morning" ? 7 : 17;
  return zonedLocalToUtc(
    local.year,
    local.month,
    local.day,
    hour,
    30,
  ).toISOString();
}

export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const intendedUtcClock = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(intendedUtcClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = calgaryParts(candidate);
    const shownAsUtcClock = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
    );
    const adjustment = intendedUtcClock - shownAsUtcClock;
    if (adjustment === 0) break;
    candidate = new Date(candidate.getTime() + adjustment);
  }
  return candidate;
}

export function formatCalgaryDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CALGARY_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
