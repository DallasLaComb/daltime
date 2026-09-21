export interface FederalHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Returns the Nth occurrence (1-based) of a given weekday (0=Sun…6=Sat) in a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** Returns the last occurrence of a weekday in a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDay = new Date(year, month - 1, daysInMonth).getDay();
  const offset = (lastDay - weekday + 7) % 7;
  return daysInMonth - offset;
}

function holidaysForYear(year: number): FederalHoliday[] {
  return [
    { date: toDateStr(year, 1, 1), name: "New Year's Day" },
    { date: toDateStr(year, 1, nthWeekday(year, 1, 1, 3)), name: 'Martin Luther King Jr. Day' },
    { date: toDateStr(year, 2, nthWeekday(year, 2, 1, 3)), name: "Presidents' Day" },
    { date: toDateStr(year, 5, lastWeekday(year, 5, 1)), name: 'Memorial Day' },
    { date: toDateStr(year, 6, 19), name: 'Juneteenth' },
    { date: toDateStr(year, 7, 4), name: 'Independence Day' },
    { date: toDateStr(year, 9, nthWeekday(year, 9, 1, 1)), name: 'Labor Day' },
    { date: toDateStr(year, 10, nthWeekday(year, 10, 1, 2)), name: 'Columbus Day' },
    { date: toDateStr(year, 11, 11), name: 'Veterans Day' },
    { date: toDateStr(year, 11, nthWeekday(year, 11, 4, 4)), name: 'Thanksgiving Day' },
    { date: toDateStr(year, 12, 25), name: 'Christmas Day' },
  ];
}

/**
 * Returns US federal holidays (actual calendar dates, not observed) whose date
 * falls within [startDate, endDate] inclusive. Both parameters are YYYY-MM-DD.
 */
export function getFederalHolidaysInRange(
  startDate: string,
  endDate: string,
): FederalHoliday[] {
  const startYear = parseInt(startDate.slice(0, 4), 10);
  const endYear = parseInt(endDate.slice(0, 4), 10);

  const holidays: FederalHoliday[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const h of holidaysForYear(y)) {
      if (h.date >= startDate && h.date <= endDate) {
        holidays.push(h);
      }
    }
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}
