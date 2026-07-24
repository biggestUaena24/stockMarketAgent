export type ExchangeCalendar = "TSX" | "NYSE_NASDAQ";

export type MarketCalendarState = {
  localDate: string;
  tsx: { open: boolean; reason: string | null };
  us: { open: boolean; reason: string | null };
  anyOpen: boolean;
};

export function marketCalendarState(localDate: string): MarketCalendarState {
  const tsxReason = closureReason(localDate, "TSX");
  const usReason = closureReason(localDate, "NYSE_NASDAQ");
  return {
    localDate,
    tsx: { open: !tsxReason, reason: tsxReason },
    us: { open: !usReason, reason: usReason },
    anyOpen: !tsxReason || !usReason,
  };
}

export function closureReason(
  localDate: string,
  exchange: ExchangeCalendar,
): string | null {
  const parsed = parseDateKey(localDate);
  if (!parsed) return "Invalid local date";
  const date = utcDate(parsed.year, parsed.month, parsed.day);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return "Weekend";

  const holidays =
    exchange === "TSX"
      ? canadianMarketHolidays(parsed.year)
      : usMarketHolidays(parsed.year);
  return holidays.get(localDate) ?? null;
}

export function canadianMarketHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  addObservedFixed(holidays, year, 1, 1, "New Year’s Day");
  addNthWeekday(holidays, year, 2, 1, 3, "Family Day");
  addDate(holidays, addDays(easterSunday(year), -2), "Good Friday");
  addDate(
    holidays,
    weekdayOnOrBefore(year, 5, 24, 1),
    "Victoria Day",
  );
  addObservedFixed(holidays, year, 7, 1, "Canada Day");
  addNthWeekday(holidays, year, 8, 1, 1, "Civic Holiday");
  addNthWeekday(holidays, year, 9, 1, 1, "Labour Day");
  addNthWeekday(holidays, year, 10, 1, 2, "Thanksgiving");
  addChristmasAndBoxingDay(holidays, year);
  return holidays;
}

export function usMarketHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  addObservedFixed(holidays, year, 1, 1, "New Year’s Day");
  addNthWeekday(
    holidays,
    year,
    1,
    1,
    3,
    "Martin Luther King Jr. Day",
  );
  addNthWeekday(holidays, year, 2, 1, 3, "Presidents’ Day");
  addDate(holidays, addDays(easterSunday(year), -2), "Good Friday");
  addLastWeekday(holidays, year, 5, 1, "Memorial Day");
  addObservedFixed(holidays, year, 6, 19, "Juneteenth");
  addObservedFixed(holidays, year, 7, 4, "Independence Day");
  addNthWeekday(holidays, year, 9, 1, 1, "Labor Day");
  addNthWeekday(holidays, year, 11, 4, 4, "Thanksgiving");
  addObservedFixed(holidays, year, 12, 25, "Christmas Day");
  return holidays;
}

function addObservedFixed(
  target: Map<string, string>,
  year: number,
  month: number,
  day: number,
  label: string,
): void {
  const holiday = utcDate(year, month, day);
  const weekday = holiday.getUTCDay();
  const observed =
    weekday === 6
      ? addDays(holiday, -1)
      : weekday === 0
        ? addDays(holiday, 1)
        : holiday;
  addDate(target, observed, label);
}

function addChristmasAndBoxingDay(
  target: Map<string, string>,
  year: number,
): void {
  const christmas = utcDate(year, 12, 25);
  const boxing = utcDate(year, 12, 26);
  const christmasWeekday = christmas.getUTCDay();
  if (christmasWeekday === 6) {
    addDate(target, addDays(christmas, 2), "Christmas Day");
    addDate(target, addDays(boxing, 2), "Boxing Day");
  } else if (christmasWeekday === 0) {
    addDate(target, addDays(christmas, 2), "Christmas Day");
    addDate(target, boxing, "Boxing Day");
  } else {
    addDate(target, christmas, "Christmas Day");
    const boxingWeekday = boxing.getUTCDay();
    addDate(
      target,
      boxingWeekday === 6 ? addDays(boxing, 2) : boxing,
      "Boxing Day",
    );
  }
}

function addNthWeekday(
  target: Map<string, string>,
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
  label: string,
): void {
  const first = utcDate(year, month, 1);
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  addDate(target, addDays(first, delta + (occurrence - 1) * 7), label);
}

function addLastWeekday(
  target: Map<string, string>,
  year: number,
  month: number,
  weekday: number,
  label: string,
): void {
  const last = utcDate(year, month + 1, 0);
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  addDate(target, addDays(last, -delta), label);
}

function weekdayOnOrBefore(
  year: number,
  month: number,
  day: number,
  weekday: number,
): Date {
  const date = utcDate(year, month, day);
  const delta = (date.getUTCDay() - weekday + 7) % 7;
  return addDays(date, -delta);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function addDate(target: Map<string, string>, date: Date, label: string): void {
  target.set(dateKey(date), label);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
