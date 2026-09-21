import type { Shift } from '../../../core/models/shift.model';
import {
  buildDayIndicators,
  dayCellLabel,
  indicatorKindFor,
  parseDateKey,
  resolveSelectedDate,
} from './calendar.utils';

function shift(over: Partial<Shift>): Shift {
  return {
    shift_id: 's',
    date: '2026-09-16',
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    employee_id: 'e1',
    status: 'published',
    location_id: 'l1',
    ...over,
  } as Shift;
}

describe('indicatorKindFor', () => {
  it('uses the shift type for an assigned shift', () => {
    expect(indicatorKindFor(shift({ type: 'night' }))).toBe('night');
  });

  it('marks a shift with no employee as unassigned', () => {
    expect(indicatorKindFor(shift({ employee_id: '' }))).toBe('unassigned');
  });
});

describe('buildDayIndicators', () => {
  it('orders dots by start time', () => {
    const map = new Map([
      [
        '2026-09-16',
        [
          shift({ shift_id: 'b', start_time: '15:00', type: 'afternoon' }),
          shift({ shift_id: 'a', start_time: '07:00', type: 'morning' }),
        ],
      ],
    ]);
    expect(buildDayIndicators(map).get('2026-09-16')).toEqual(['morning', 'afternoon']);
  });

  it('appends unfilled slots after shifts and creates days that only have unfilled slots', () => {
    const shifts = new Map([['2026-09-16', [shift({})]]]);
    const unfilled = new Map([
      ['2026-09-16', 2],
      ['2026-09-20', 1],
    ]);
    const result = buildDayIndicators(shifts, unfilled);

    expect(result.get('2026-09-16')).toEqual(['morning', 'unfilled', 'unfilled']);
    expect(result.get('2026-09-20')).toEqual(['unfilled']);
  });

  it('omits empty days and ignores non-positive unfilled counts', () => {
    const result = buildDayIndicators(new Map([['2026-09-01', []]]), new Map([['2026-09-02', 0]]));
    expect(result.size).toBe(0);
  });
});

describe('resolveSelectedDate', () => {
  const today = new Date(2026, 8, 20);

  it('keeps the selection while it is in the visible month', () => {
    const selected = new Date(2026, 8, 3);
    expect(resolveSelectedDate(selected, new Date(2026, 8, 20), today)).toBe(selected);
  });

  it('falls back to today when the selection is in another month and today is visible', () => {
    const result = resolveSelectedDate(new Date(2026, 7, 3), new Date(2026, 8, 1), today);
    expect(result).toBe(today);
  });

  it('falls back to the 1st when neither the selection nor today is visible', () => {
    const result = resolveSelectedDate(null, new Date(2026, 9, 15), today);
    expect(result).toEqual(new Date(2026, 9, 1));
  });
});

describe('parseDateKey', () => {
  it('parses as a local date', () => {
    const d = parseDateKey('2026-09-16');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 16]);
  });
});

describe('dayCellLabel', () => {
  const date = new Date(2026, 8, 16);

  it('describes an empty day', () => {
    expect(dayCellLabel(date, [])).toBe('Wednesday, September 16, no shifts');
  });

  it('pluralises and separates unfilled slots from shifts', () => {
    expect(dayCellLabel(date, ['morning'])).toBe('Wednesday, September 16, 1 shift');
    expect(dayCellLabel(date, ['morning', 'night', 'unfilled'])).toBe(
      'Wednesday, September 16, 2 shifts, 1 not scheduled',
    );
  });
});
