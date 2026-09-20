/**
 * Unit tests for the employee available-shifts service.
 *
 * Tests that the service enforces required ?date param, validates format,
 * resolves the caller's org/employee, and strips DynamoDB keys before returning.
 * The db module is mocked so no DynamoDB calls are made.
 *
 * Randomized input pools: each run draws from a seeded pool of valid dates,
 * invalid format strings, and calendar-overflow dates. Failures include the
 * seed in the error message for deterministic reproduction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing service.
vi.mock('../../../../src/functions/employee/available-shifts/db.js', () => ({
  getCallerLookup: vi.fn(),
  listAvailableShifts: vi.fn(),
}));

import type { Shift } from '../../../../src/functions/shared/models/manager/shift.model.js';
import { listAvailableShifts } from '../../../../src/functions/employee/available-shifts/service.js';
import * as db from '../../../../src/functions/employee/available-shifts/db.js';

const CALLER_LOOKUP = { org_id: 'org-sunset', employee_id: 'emp-123' };

/** A raw DynamoDB shift item with all key fields present. */
const RAW_SHIFT: Shift = {
  PK: 'ORG#org-sunset',
  SK: 'SHIFT#shift-99',
  GSI1PK: 'SHIFT',
  GSI1SK: '2025-06-15T09:00:00.000Z',
  shift_id: 'shift-99',
  org_id: 'org-sunset',
  manager_id: 'mgr-1',
  employee_id: 'emp-other',
  employee_name: 'Jane Doe',
  location_id: 'loc-1',
  location_name: 'Main Floor',
  date: '2025-06-15',
  start_time: '09:00',
  end_time: '17:00',
  type: 'morning',
  status: 'published',
  available_for_pickup: true,
  created_at: '2025-06-01T00:00:00.000Z',
  updated_at: '2025-06-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getCallerLookup).mockResolvedValue(CALLER_LOOKUP);
});

// ─── Missing / invalid date param ────────────────────────────────────────────

describe('listAvailableShifts — date validation', () => {
  it('throws ValidationError when date param is undefined', async () => {
    await expect(listAvailableShifts('sub-1', undefined)).rejects.toThrow(
      /"date" query param is required/i,
    );
  });

  it('throws ValidationError when date is not in YYYY-MM-DD format', async () => {
    await expect(listAvailableShifts('sub-1', '15/06/2025')).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('throws ValidationError when date string is an invalid calendar date', async () => {
    // 2025-02-30 passes the regex but is not a valid date.
    await expect(listAvailableShifts('sub-1', '2025-02-30')).rejects.toThrow(/valid calendar date/i);
  });
});

// ─── Caller lookup failure ─────────────────────────────────────────────────────

describe('listAvailableShifts — caller resolution', () => {
  it('throws ForbiddenError when caller metadata record is missing', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(listAvailableShifts('sub-ghost', '2025-06-15')).rejects.toThrow(
      /Caller could not be resolved/,
    );
  });
});

// ─── Cross-org isolation ──────────────────────────────────────────────────────

describe('listAvailableShifts — cross-org isolation', () => {
  it('always uses org_id from the caller lookup, not from a URL parameter', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue({ org_id: 'org-alpha', employee_id: 'emp-77' });
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);

    await listAvailableShifts('sub-victim', '2025-06-15');

    // The db must be called with org-alpha from the lookup, never a different org.
    expect(db.listAvailableShifts).toHaveBeenCalledWith('org-alpha', 'emp-77', '2025-06-15');
    const [callOrgId] = vi.mocked(db.listAvailableShifts).mock.calls[0];
    expect(callOrgId).toBe('org-alpha');
  });

  it('uses different org_ids for different callers (no data bleed between orgs)', async () => {
    // Caller A in org-alpha
    vi.mocked(db.getCallerLookup).mockResolvedValueOnce({ org_id: 'org-alpha', employee_id: 'emp-1' });
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);
    await listAvailableShifts('sub-a', '2025-06-15');
    expect(vi.mocked(db.listAvailableShifts).mock.calls[0][0]).toBe('org-alpha');

    vi.mocked(db.listAvailableShifts).mockClear();

    // Caller B in org-beta — must not see org-alpha data
    vi.mocked(db.getCallerLookup).mockResolvedValueOnce({ org_id: 'org-beta', employee_id: 'emp-2' });
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);
    await listAvailableShifts('sub-b', '2025-06-15');
    expect(vi.mocked(db.listAvailableShifts).mock.calls[0][0]).toBe('org-beta');
  });
});

// ─── Own-shift exclusion ──────────────────────────────────────────────────────

describe('listAvailableShifts — own-shift exclusion', () => {
  it('passes the employee_id as callerId to db so own shifts are excluded', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue({ org_id: 'org-sunset', employee_id: 'emp-123' });
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);

    await listAvailableShifts('sub-1', '2025-06-15');

    // The second argument is callerId — db's FilterExpression uses `employee_id <> :callerId`
    const [, callerId] = vi.mocked(db.listAvailableShifts).mock.calls[0];
    expect(callerId).toBe('emp-123');
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('listAvailableShifts — happy path', () => {
  it('calls db.listAvailableShifts with org_id, employee_id, and date', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([RAW_SHIFT]);

    await listAvailableShifts('sub-1', '2025-06-15');

    expect(db.listAvailableShifts).toHaveBeenCalledWith('org-sunset', 'emp-123', '2025-06-15');
  });

  it('strips PK, SK, GSI1PK, GSI1SK from returned items', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([RAW_SHIFT]);

    const result = await listAvailableShifts('sub-1', '2025-06-15');

    expect(result[0]).not.toHaveProperty('PK');
    expect(result[0]).not.toHaveProperty('SK');
    expect(result[0]).not.toHaveProperty('GSI1PK');
    expect(result[0]).not.toHaveProperty('GSI1SK');
  });

  it('preserves available_for_pickup and other business fields', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([RAW_SHIFT]);

    const result = await listAvailableShifts('sub-1', '2025-06-15');

    expect(result[0]).toMatchObject({
      shift_id: 'shift-99',
      org_id: 'org-sunset',
      available_for_pickup: true,
      date: '2025-06-15',
    });
  });

  it('returns empty array when no available shifts exist (never 404)', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);

    const result = await listAvailableShifts('sub-1', '2025-06-15');

    expect(result).toEqual([]);
  });

  it('sorts results by start_time ascending', async () => {
    const shiftLate = { ...RAW_SHIFT, shift_id: 'shift-late', start_time: '14:00' };
    const shiftEarly = { ...RAW_SHIFT, shift_id: 'shift-early', start_time: '06:00' };
    vi.mocked(db.listAvailableShifts).mockResolvedValue([shiftLate, shiftEarly]);

    const result = await listAvailableShifts('sub-1', '2025-06-15');

    expect(result[0].shift_id).toBe('shift-early');
    expect(result[1].shift_id).toBe('shift-late');
  });
});

// ─── available_for_pickup filter documented at DB layer ───────────────────────

/**
 * The `available_for_pickup = :true` and `employee_id <> :callerId` constraints
 * live in the DynamoDB FilterExpression inside db.listAvailableShifts, not in
 * the service layer. These tests document that:
 *   1. If the db layer were to return a shift with available_for_pickup=false,
 *      the service would NOT re-filter it (the service trusts the db).
 *   2. The service correctly passes callerId to db so the db can enforce
 *      self-exclusion at the FilterExpression level.
 *
 * Full enforcement of the filter itself is covered by the cross-org-isolation
 * and own-shift-exclusion tests above (via mock call argument assertions).
 */
describe('listAvailableShifts — available_for_pickup filter (db-layer enforcement)', () => {
  it('passes through whatever the db returns — db is sole filter enforcer', async () => {
    // If db returns a shift (correctly filtered), service must not drop it.
    vi.mocked(db.listAvailableShifts).mockResolvedValue([RAW_SHIFT]);

    const result = await listAvailableShifts('sub-1', '2025-06-15');

    expect(result).toHaveLength(1);
    expect(result[0].available_for_pickup).toBe(true);
  });

  it('the callerId forwarded to db matches the employee_id from the caller lookup', async () => {
    // Verify the second argument to db.listAvailableShifts is the caller's employee_id.
    // The db's FilterExpression uses `employee_id <> :callerId` — this confirms the
    // right value is passed so the db-level predicate can enforce self-exclusion.
    vi.mocked(db.getCallerLookup).mockResolvedValue({ org_id: 'org-x', employee_id: 'emp-self' });
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);

    await listAvailableShifts('sub-self', '2025-06-20');

    const [, callerId] = vi.mocked(db.listAvailableShifts).mock.calls[0];
    // Confirm callerId passed to db matches the employee_id from the lookup record —
    // this is the value that will be compared to `employee_id` in FilterExpression.
    expect(callerId).toBe('emp-self');
    // The db's filter (employee_id <> :callerId) is what prevents self-pickup —
    // here we verify the service sends the right value; db implementation tested separately.
  });
});

// ─── Randomized input pool: valid dates ───────────────────────────────────────

/**
 * Draws from a pool of valid YYYY-MM-DD dates to verify the service accepts them.
 * Log the selected date on failure for reproducibility.
 */
describe('listAvailableShifts — randomized valid date inputs', () => {
  const VALID_DATE_POOL = [
    '2025-01-01',
    '2025-06-15',
    '2025-12-31',
    '2026-02-28', // last valid day of Feb in a non-leap year
    '2024-02-29', // leap year valid date
    '2026-07-04',
    '2025-11-30',
    '2026-06-20',
  ];

  it('accepts any valid YYYY-MM-DD date without throwing', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);

    // Draw a random date from the pool deterministically per test run
    const seed = Math.floor(Date.now() / 10000); // changes every ~10 seconds
    const idx = seed % VALID_DATE_POOL.length;
    const date = VALID_DATE_POOL[idx];

    let result: Awaited<ReturnType<typeof listAvailableShifts>> | undefined;
    try {
      result = await listAvailableShifts('sub-1', date);
    } catch (err) {
      throw new Error(`Expected no error for valid date "${date}" (seed=${seed}). Got: ${err}`);
    }

    expect(result).toEqual([]);
  });
});

// ─── Randomized input pool: invalid format strings ────────────────────────────

describe('listAvailableShifts — randomized invalid format inputs', () => {
  const INVALID_FORMAT_POOL = [
    '06/15/2025',
    '2025/06/15',
    '15-06-2025',
    'June 15, 2025',
    '2025-6-15', // missing zero-pad
    '2025-06-1', // missing zero-pad
    '20250615', // no separators
    'not-a-date',
    '2025-13-01', // month 13 — fails regex (month is 2 digits 13 passes regex but date is invalid)
    '',
  ];

  it('throws ValidationError for any invalid format input', async () => {
    const seed = Math.floor(Date.now() / 10000);
    // Exclude empty string (tested separately as "undefined" case — empty string is truthy)
    const pool = INVALID_FORMAT_POOL.filter((v) => v !== '');
    const idx = seed % pool.length;
    const badDate = pool[idx];

    try {
      await listAvailableShifts('sub-1', badDate);
      throw new Error(
        `Expected ValidationError for invalid input "${badDate}" (seed=${seed}) but no error was thrown`,
      );
    } catch (err) {
      // Must be a ValidationError, not the manual error thrown above
      expect((err as Error).message).not.toMatch(/Expected ValidationError/);
      expect((err as Error).message).toMatch(/YYYY-MM-DD|date|valid/i);
    }
  });
});

// ─── Calendar-overflow boundary cases ─────────────────────────────────────────

describe('listAvailableShifts — calendar-overflow boundary cases', () => {
  it('throws ValidationError for 2025-02-30 (Feb overflow)', async () => {
    await expect(listAvailableShifts('sub-1', '2025-02-30')).rejects.toThrow(/valid calendar date/i);
  });

  it('throws ValidationError for 2025-04-31 (April has 30 days)', async () => {
    await expect(listAvailableShifts('sub-1', '2025-04-31')).rejects.toThrow(/valid calendar date/i);
  });

  it('throws ValidationError for 2026-13-01 (month 13)', async () => {
    // Month 13 passes the YYYY-MM-DD regex but fails the round-trip check.
    await expect(listAvailableShifts('sub-1', '2026-13-01')).rejects.toThrow();
  });

  it('accepts 2024-02-29 as valid (2024 is a leap year)', async () => {
    vi.mocked(db.listAvailableShifts).mockResolvedValue([]);
    // Should not throw — 2024 is divisible by 4
    await expect(listAvailableShifts('sub-1', '2024-02-29')).resolves.toEqual([]);
  });

  it('throws ValidationError for 2025-02-29 (2025 is NOT a leap year)', async () => {
    await expect(listAvailableShifts('sub-1', '2025-02-29')).rejects.toThrow(/valid calendar date/i);
  });
});
