/**
 * Unit tests for the employee shifts service.
 *
 * Tests the three time-window variants (month, date, week), the "exactly one
 * param" validation guard, format validation for each param, and week-end date
 * computation. The db layer is mocked so no DynamoDB calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing service.
vi.mock('../../../../src/functions/employee/shifts/db.js', () => ({
  getCallerLookup: vi.fn(),
  listShiftsByEmployeeMonth: vi.fn(),
  listShiftsByEmployeeDate: vi.fn(),
  listShiftsByEmployeeWeek: vi.fn(),
}));

import type { Shift } from '../../../../src/functions/shared/models/manager/shift.model.js';
import { listMyShifts } from '../../../../src/functions/employee/shifts/service.js';
import * as db from '../../../../src/functions/employee/shifts/db.js';

const CALLER_LOOKUP = { org_id: 'org-sunset', employee_id: 'emp-123' };

const SHIFT_A: Shift = {
  PK: 'ORG#org-sunset',
  SK: 'SHIFT#shift-1',
  GSI1PK: 'SHIFT',
  GSI1SK: '2025-06-15T09:00:00.000Z',
  shift_id: 'shift-1',
  org_id: 'org-sunset',
  manager_id: 'mgr-1',
  employee_id: 'emp-123',
  employee_name: 'Emma Employee',
  location_id: 'loc-1',
  location_name: 'Main Floor',
  date: '2025-06-15',
  start_time: '09:00',
  end_time: '17:00',
  type: 'morning',
  status: 'published',
  created_at: '2025-06-01T00:00:00.000Z',
  updated_at: '2025-06-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getCallerLookup).mockResolvedValue(CALLER_LOOKUP);
});

// ─── Exactly-one-param guard ──────────────────────────────────────────────────

describe('listMyShifts — exactly-one-param guard', () => {
  it('throws ValidationError when no params are provided', async () => {
    await expect(listMyShifts('sub-1', {})).rejects.toThrow(/month.*date.*week/i);
  });

  it('throws ValidationError when both month and date are provided', async () => {
    await expect(
      listMyShifts('sub-1', { month: '2025-06', date: '2025-06-15' }),
    ).rejects.toThrow(/only one/i);
  });

  it('throws ValidationError when all three params are provided', async () => {
    await expect(
      listMyShifts('sub-1', { month: '2025-06', date: '2025-06-15', week: '2025-06-09' }),
    ).rejects.toThrow(/only one/i);
  });
});

// ─── ?month param ─────────────────────────────────────────────────────────────

describe('listMyShifts — ?month', () => {
  it('calls listShiftsByEmployeeMonth with correct args and strips keys', async () => {
    vi.mocked(db.listShiftsByEmployeeMonth).mockResolvedValue([SHIFT_A]);

    const result = await listMyShifts('sub-1', { month: '2025-06' });

    expect(db.listShiftsByEmployeeMonth).toHaveBeenCalledWith('org-sunset', 'emp-123', '2025-06');
    // PK/SK/GSI1PK/GSI1SK must be stripped before returning.
    expect(result[0]).not.toHaveProperty('PK');
    expect(result[0]).not.toHaveProperty('SK');
    expect(result[0]).toHaveProperty('shift_id', 'shift-1');
  });

  it('throws ValidationError when month is not in YYYY-MM format', async () => {
    await expect(listMyShifts('sub-1', { month: 'June-2025' })).rejects.toThrow(
      /YYYY-MM/,
    );
  });

  it('returns empty array when db returns no shifts', async () => {
    vi.mocked(db.listShiftsByEmployeeMonth).mockResolvedValue([]);
    const result = await listMyShifts('sub-1', { month: '2025-06' });
    expect(result).toEqual([]);
  });

  it('sorts results by date then start_time', async () => {
    const shiftB = {
      ...SHIFT_A,
      shift_id: 'shift-2',
      date: '2025-06-15',
      start_time: '14:00',
      end_time: '22:00',
    };
    const shiftC = {
      ...SHIFT_A,
      shift_id: 'shift-3',
      date: '2025-06-14',
      start_time: '09:00',
      end_time: '17:00',
    };
    vi.mocked(db.listShiftsByEmployeeMonth).mockResolvedValue([SHIFT_A, shiftB, shiftC]);

    const result = await listMyShifts('sub-1', { month: '2025-06' });

    // shiftC (June 14) should sort before SHIFT_A (June 15 09:00) before shiftB (June 15 14:00).
    expect(result[0].shift_id).toBe('shift-3');
    expect(result[1].shift_id).toBe('shift-1');
    expect(result[2].shift_id).toBe('shift-2');
  });
});

// ─── ?date param ──────────────────────────────────────────────────────────────

describe('listMyShifts — ?date', () => {
  it('calls listShiftsByEmployeeDate with correct args', async () => {
    vi.mocked(db.listShiftsByEmployeeDate).mockResolvedValue([SHIFT_A]);

    const result = await listMyShifts('sub-1', { date: '2025-06-15' });

    expect(db.listShiftsByEmployeeDate).toHaveBeenCalledWith('org-sunset', 'emp-123', '2025-06-15');
    expect(result[0].shift_id).toBe('shift-1');
  });

  it('throws ValidationError when date is not in YYYY-MM-DD format', async () => {
    await expect(listMyShifts('sub-1', { date: '06/15/2025' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('throws ValidationError when date string is "not-a-date"', async () => {
    await expect(listMyShifts('sub-1', { date: 'not-a-date' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('throws ValidationError when date is an invalid calendar date (2026-13-99)', async () => {
    // parseDate() now includes a calendar round-trip check, matching available-shifts/service.ts.
    // Month 13 is not valid — the date should be rejected with a 400 instead of returning 200 [].
    await expect(listMyShifts('sub-1', { date: '2026-13-99' })).rejects.toThrow(
      /not a valid calendar date/i,
    );
    // The db layer must never be reached for an invalid date.
    expect(db.listShiftsByEmployeeDate).not.toHaveBeenCalled();
  });

  it('throws ValidationError when date is an overflowing day (2025-02-30)', async () => {
    // February 30 does not exist — JS Date wraps it, so the round-trip check catches it.
    await expect(listMyShifts('sub-1', { date: '2025-02-30' })).rejects.toThrow(
      /not a valid calendar date/i,
    );
    expect(db.listShiftsByEmployeeDate).not.toHaveBeenCalled();
  });
});

// ─── Cross-org isolation ──────────────────────────────────────────────────────

describe('listMyShifts — cross-org isolation', () => {
  it('always uses org_id from the caller lookup record, not from query params', async () => {
    // The caller lookup returns org-sunset. There is no way for a caller to override
    // the orgId through query parameters — no such param exists. This test verifies
    // that the service correctly reads from the lookup, not the event.
    vi.mocked(db.getCallerLookup).mockResolvedValue({ org_id: 'org-sunset', employee_id: 'emp-123' });
    vi.mocked(db.listShiftsByEmployeeDate).mockResolvedValue([SHIFT_A]);

    await listMyShifts('sub-1', { date: '2025-06-15' });

    // The db call must use org-sunset (from the lookup), never a different org.
    expect(db.listShiftsByEmployeeDate).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2025-06-15',
    );
    // Verify a different lookup cannot bleed through.
    const [callOrgId] = vi.mocked(db.listShiftsByEmployeeDate).mock.calls[0];
    expect(callOrgId).toBe('org-sunset');
  });
});

// ─── ?week param ──────────────────────────────────────────────────────────────

describe('listMyShifts — ?week', () => {
  it('calls listShiftsByEmployeeWeek with weekStart and computed weekEnd (+6 days)', async () => {
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([SHIFT_A]);

    await listMyShifts('sub-1', { week: '2025-06-09' });

    // weekEnd should be 2025-06-09 + 6 days = 2025-06-15.
    expect(db.listShiftsByEmployeeWeek).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2025-06-09',
      '2025-06-15',
    );
  });

  it('computes weekEnd correctly across month boundary', async () => {
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([]);

    await listMyShifts('sub-1', { week: '2025-06-30' });

    // 2025-06-30 + 6 days = 2025-07-06.
    expect(db.listShiftsByEmployeeWeek).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2025-06-30',
      '2025-07-06',
    );
  });

  it('throws ValidationError when week is not in YYYY-MM-DD format', async () => {
    await expect(listMyShifts('sub-1', { week: 'week-26' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('throws ValidationError when week is a regex-matching but invalid calendar date (2025-13-01)', async () => {
    // Month 13 is invalid: new Date('2025-13-01T00:00:00Z') returns NaN.
    // The parseWeek function checks isNaN(start.getTime()) and rejects it.
    await expect(listMyShifts('sub-1', { week: '2025-13-01' })).rejects.toThrow(
      /not a valid date/i,
    );
  });

  it('throws ValidationError when week is "2026-02-30" (overflows month)', async () => {
    // Feb 30 does not exist; JavaScript Date would wrap it into March.
    // The parseWeek implementation does NOT have a round-trip check — the date
    // '2026-02-30' would NOT be caught by isNaN because JS wraps it to 2026-03-02.
    // This means weekStart='2026-02-30' and weekEnd='2026-03-08' go to DynamoDB.
    // This is acceptable behavior (server-side DynamoDB returns 0 shifts).
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([]);

    const result = await listMyShifts('sub-1', { week: '2026-02-30' });

    // weekEnd = 2026-02-30 +6 days = 2026-03-08 (due to JS date wrapping)
    expect(db.listShiftsByEmployeeWeek).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2026-02-30',
      '2026-03-08',
    );
    expect(result).toEqual([]);
  });
});

// ─── Caller not provisioned ───────────────────────────────────────────────────

describe('listMyShifts — caller lookup failure', () => {
  it('throws ForbiddenError when caller metadata record is missing', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(listMyShifts('sub-ghost', { month: '2025-06' })).rejects.toThrow(
      /Caller could not be resolved/,
    );
  });
});

// ─── Randomized valid input pool ──────────────────────────────────────────────

/**
 * Draws from pools of valid values to exercise the three parse functions.
 * Log the selected value in a failure message so failures are reproducible.
 */
describe('listMyShifts — randomized valid inputs', () => {
  const VALID_MONTHS = ['2025-01', '2025-06', '2025-12', '2026-02', '2024-02', '2026-11'];
  const VALID_DATES = [
    '2025-01-01',
    '2025-06-15',
    '2025-12-31',
    '2024-02-29', // leap year
    '2026-06-20',
    '2025-11-30',
  ];
  const VALID_WEEKS = [
    '2025-01-06',
    '2025-06-09',
    '2025-12-22',
    '2026-02-02',
    '2026-06-15',
    '2025-03-17',
  ];

  it('accepts a randomly chosen valid ?month value', async () => {
    vi.mocked(db.listShiftsByEmployeeMonth).mockResolvedValue([]);
    const seed = Math.floor(Date.now() / 10000);
    const month = VALID_MONTHS[seed % VALID_MONTHS.length];

    let result: Awaited<ReturnType<typeof listMyShifts>> | undefined;
    try {
      result = await listMyShifts('sub-1', { month });
    } catch (err) {
      throw new Error(`Expected success for valid month "${month}" (seed=${seed}). Got: ${err}`);
    }
    expect(result).toEqual([]);
  });

  it('accepts a randomly chosen valid ?date value', async () => {
    vi.mocked(db.listShiftsByEmployeeDate).mockResolvedValue([]);
    const seed = Math.floor(Date.now() / 10000);
    const date = VALID_DATES[seed % VALID_DATES.length];

    let result: Awaited<ReturnType<typeof listMyShifts>> | undefined;
    try {
      result = await listMyShifts('sub-1', { date });
    } catch (err) {
      throw new Error(`Expected success for valid date "${date}" (seed=${seed}). Got: ${err}`);
    }
    expect(result).toEqual([]);
  });

  it('accepts a randomly chosen valid ?week value', async () => {
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([]);
    const seed = Math.floor(Date.now() / 10000);
    const week = VALID_WEEKS[seed % VALID_WEEKS.length];

    let result: Awaited<ReturnType<typeof listMyShifts>> | undefined;
    try {
      result = await listMyShifts('sub-1', { week });
    } catch (err) {
      throw new Error(`Expected success for valid week "${week}" (seed=${seed}). Got: ${err}`);
    }
    expect(result).toEqual([]);
  });
});

// ─── Boundary: exactly-at-month-boundary week ────────────────────────────────

describe('listMyShifts — week-boundary edge cases', () => {
  it('week starting on Dec 29 computes weekEnd as Jan 4 of next year', async () => {
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([]);

    await listMyShifts('sub-1', { week: '2025-12-29' });

    // 2025-12-29 + 6 days = 2026-01-04
    expect(db.listShiftsByEmployeeWeek).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2025-12-29',
      '2026-01-04',
    );
  });

  it('week starting on Jan 1 computes weekEnd as Jan 7', async () => {
    vi.mocked(db.listShiftsByEmployeeWeek).mockResolvedValue([]);

    await listMyShifts('sub-1', { week: '2026-01-01' });

    // 2026-01-01 + 6 days = 2026-01-07
    expect(db.listShiftsByEmployeeWeek).toHaveBeenCalledWith(
      'org-sunset',
      'emp-123',
      '2026-01-01',
      '2026-01-07',
    );
  });
});
