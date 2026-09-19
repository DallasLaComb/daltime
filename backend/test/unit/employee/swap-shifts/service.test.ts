/**
 * Unit tests for the employee swap-shifts service.
 *
 * Covers all three operations (postSwapShift, claimSwapShift, cancelSwapShift)
 * plus listSwapShifts. For each operation the tests verify:
 *  - happy path (correct DB writes, correct return shape, keys stripped)
 *  - each documented validation/auth error (400/403/404/409)
 *  - manager notification is written on success
 *  - manager notification failure is isolated (does not fail the primary response)
 *  - boundary values (exactly today's date for past-shift guard, etc.)
 *  - swapId/shift_id input validation (regex gate)
 *
 * The db module and putNotification are both fully mocked so no DynamoDB calls
 * are made. Randomised test data pools are used so edge cases surface across
 * runs; failed test output includes the actual inputs used.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock db and notification modules before service import ───────────────────

vi.mock('../../../../src/functions/employee/swap-shifts/db.js', () => ({
  getCallerLookup: vi.fn(),
  getShiftById: vi.fn(),
  findOpenSwapForShift: vi.fn(),
  getEmployeeByIdInOrg: vi.fn(),
  putSwap: vi.fn(),
  getSwapById: vi.fn(),
  claimSwapAndTransferShift: vi.fn(),
  cancelSwap: vi.fn(),
  listOpenSwapsForOrg: vi.fn(),
  listMyPostedSwaps: vi.fn(),
}));

vi.mock('../../../../src/functions/shared/notifications/db.js', () => ({
  putNotification: vi.fn(),
}));

import {
  listSwapShifts,
  postSwapShift,
  claimSwapShift,
  cancelSwapShift,
} from '../../../../src/functions/employee/swap-shifts/service.js';
import * as db from '../../../../src/functions/employee/swap-shifts/db.js';
import { putNotification } from '../../../../src/functions/shared/notifications/db.js';

// ─── Randomised data pools ────────────────────────────────────────────────────

const ORG_POOL = ['org-alpha', 'org-beta-99', 'org-gamma-x1', 'org-delta-z2'];
const EMP_POOL = ['emp-aaa', 'emp-bbb', 'emp-ccc', 'emp-ddd'];
const MGR_POOL = ['mgr-001', 'mgr-002', 'mgr-003'];
const SHIFT_ID_POOL = [
  'aaaa1111-1111-1111-1111-111111111111',
  'shift-2a3b-4c5d',
  'shift-xyz-789',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
];
const SWAP_ID_POOL = [
  'swap-uuid-0001',
  'swap-uuid-0002',
  'deadbeef-dead-beef-dead-beefdeadbeef',
  'swap-4321',
];

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Shared fixture builders ──────────────────────────────────────────────────

interface CallerLookup {
  org_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  manager_id: string;
}

function makeCallerLookup(overrides: Partial<CallerLookup> = {}): CallerLookup {
  return {
    org_id: pick(ORG_POOL),
    employee_id: pick(EMP_POOL),
    first_name: 'Alice',
    last_name: 'Worker',
    manager_id: pick(MGR_POOL),
    ...overrides,
  };
}

interface MockShift {
  PK: string;
  SK: string;
  shift_id: string;
  org_id: string;
  employee_id: string;
  employee_name: string;
  manager_id: string;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
  location_id: string;
  location_name: string;
  created_at: string;
  updated_at: string;
}

function makeShift(orgId: string, employeeId: string, overrides: Partial<MockShift> = {}): MockShift {
  const shiftId = pick(SHIFT_ID_POOL);
  return {
    PK: `ORG#${orgId}`,
    SK: `SHIFT#${shiftId}`,
    shift_id: shiftId,
    org_id: orgId,
    employee_id: employeeId,
    employee_name: 'Alice Worker',
    manager_id: pick(MGR_POOL),
    date: '2026-09-01',
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    status: 'published',
    location_id: 'loc-1',
    location_name: 'Main Floor',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockEmployeeRecord {
  PK: string;
  SK: string;
  employee_id: string;
  org_id: string;
  manager_id: string;
  first_name: string;
  last_name: string;
}

function makeEmployeeRecord(orgId: string, employeeId: string, managerId: string): MockEmployeeRecord {
  return {
    PK: `ORG#${orgId}`,
    SK: `EMPLOYEE#${employeeId}`,
    employee_id: employeeId,
    org_id: orgId,
    manager_id: managerId,
    first_name: 'Alice',
    last_name: 'Worker',
  };
}

interface MockSwap {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  swap_id: string;
  org_id: string;
  shift_id: string;
  posted_by_employee_id: string;
  posted_by_employee_name: string;
  manager_id: string;
  status: string;
  claimed_by_employee_id: string | null;
  claimed_by_employee_name: string | null;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  location_id: string;
  location_name: string;
  created_at: string;
  updated_at: string;
}

function makeSwap(orgId: string, posterEmpId: string, overrides: Partial<MockSwap> = {}): MockSwap {
  const swapId = pick(SWAP_ID_POOL);
  const now = '2026-06-19T14:30:00.000Z';
  return {
    PK: `ORG#${orgId}`,
    SK: `SWAP#${swapId}`,
    GSI1PK: `ORG_SWAP#${orgId}`,
    GSI1SK: `STATUS#open#${now}`,
    swap_id: swapId,
    org_id: orgId,
    shift_id: pick(SHIFT_ID_POOL),
    posted_by_employee_id: posterEmpId,
    posted_by_employee_name: 'Jane Poster',
    manager_id: pick(MGR_POOL),
    status: 'open',
    claimed_by_employee_id: null,
    claimed_by_employee_name: null,
    date: '2026-09-15',
    start_time: '14:00',
    end_time: '22:00',
    type: 'evening',
    location_id: 'loc-2',
    location_name: 'North Branch',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// The past-shift guard compares shift.date against the real current date, so the
// fixture dates below silently became "past" once that day arrived — the suite
// passed for months, then broke on 2026-09-07 with no code change. Freeze the
// clock instead of bumping the dates, which would only rot again. Only Date is
// faked; faking timers wholesale would stall the async service calls.
const FROZEN_NOW = new Date('2026-08-25T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
  vi.clearAllMocks();
  vi.mocked(db.putSwap).mockResolvedValue(undefined);
  vi.mocked(db.claimSwapAndTransferShift).mockResolvedValue(undefined);
  vi.mocked(db.cancelSwap).mockResolvedValue(undefined);
  vi.mocked(putNotification).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// listSwapShifts
// ═════════════════════════════════════════════════════════════════════════════

describe('listSwapShifts', () => {
  it('returns { available, mine } with DynamoDB keys stripped', async () => {
    const caller = makeCallerLookup();
    const swapA = makeSwap(caller.org_id, 'emp-other');
    const swapB = makeSwap(caller.org_id, caller.employee_id);

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.listOpenSwapsForOrg).mockResolvedValue([swapA]);
    vi.mocked(db.listMyPostedSwaps).mockResolvedValue([swapB]);

    const result = await listSwapShifts('sub-caller');

    expect(result.available).toHaveLength(1);
    expect(result.mine).toHaveLength(1);

    // DynamoDB key fields must be stripped from the returned records.
    expect(result.available[0]).not.toHaveProperty('PK');
    expect(result.available[0]).not.toHaveProperty('SK');
    expect(result.available[0]).not.toHaveProperty('GSI1PK');
    expect(result.available[0]).not.toHaveProperty('GSI1SK');
    expect(result.mine[0]).not.toHaveProperty('PK');

    expect(db.listOpenSwapsForOrg).toHaveBeenCalledWith(caller.org_id, caller.employee_id);
    expect(db.listMyPostedSwaps).toHaveBeenCalledWith(caller.org_id, caller.employee_id);
  });

  it('returns empty arrays when no swaps exist', async () => {
    const caller = makeCallerLookup();
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.listOpenSwapsForOrg).mockResolvedValue([]);
    vi.mocked(db.listMyPostedSwaps).mockResolvedValue([]);

    const result = await listSwapShifts('sub-caller');

    expect(result.available).toEqual([]);
    expect(result.mine).toEqual([]);
  });

  it('throws ForbiddenError when caller has no provisioned record', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(listSwapShifts('sub-ghost')).rejects.toThrow(/Caller could not be resolved/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// postSwapShift
// ═════════════════════════════════════════════════════════════════════════════

describe('postSwapShift — input validation', () => {
  it('throws ValidationError when shift_id is missing', async () => {
    await expect(postSwapShift('sub-emp', {})).rejects.toThrow(/shift_id is required/i);
  });

  it('throws ValidationError when shift_id is empty string', async () => {
    await expect(postSwapShift('sub-emp', { shift_id: '' })).rejects.toThrow(/shift_id is required/i);
  });

  it('throws ValidationError when shift_id is whitespace only', async () => {
    await expect(postSwapShift('sub-emp', { shift_id: '   ' })).rejects.toThrow(/shift_id is required/i);
  });

  it('throws ValidationError when shift_id contains injection characters (<script>)', async () => {
    await expect(
      postSwapShift('sub-emp', { shift_id: '<script>alert(1)</script>' }),
    ).rejects.toThrow(/shift_id must contain only/i);
  });

  it('throws ValidationError when shift_id exceeds 128 characters', async () => {
    const tooLong = 'a'.repeat(129);
    await expect(postSwapShift('sub-emp', { shift_id: tooLong })).rejects.toThrow(
      /shift_id must contain only/i,
    );
  });

  it('throws ValidationError when shift_id is exactly 128 chars but has forbidden chars', async () => {
    const borderInvalid = 'a'.repeat(127) + '!';
    await expect(postSwapShift('sub-emp', { shift_id: borderInvalid })).rejects.toThrow(
      /shift_id must contain only/i,
    );
  });

  it('accepts shift_id that is exactly 128 valid characters', async () => {
    const caller = makeCallerLookup();
    const shiftId = 'a'.repeat(128);
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(
      makeShift(caller.org_id, caller.employee_id, { shift_id: shiftId }) as never,
    );
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(
      makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id) as never,
    );

    // Should not throw validation error — may proceed to putSwap.
    const result = await postSwapShift('sub-emp', { shift_id: shiftId });
    expect(result).toHaveProperty('shift_id', shiftId);
    expect(result).not.toHaveProperty('PK');
  });
});

describe('postSwapShift — caller resolution', () => {
  it('throws ForbiddenError when caller not provisioned', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(postSwapShift('sub-ghost', { shift_id: pick(SHIFT_ID_POOL) })).rejects.toThrow(
      /Caller could not be resolved/,
    );
  });
});

describe('postSwapShift — shift validation', () => {
  it('throws NotFoundError when shift does not exist', async () => {
    const caller = makeCallerLookup();
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(null);

    await expect(postSwapShift('sub-emp', { shift_id: pick(SHIFT_ID_POOL) })).rejects.toThrow(
      /Shift not found/,
    );
  });

  it('throws ForbiddenError when shift belongs to a different employee', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-me' });
    const shift = makeShift(caller.org_id, 'emp-someone-else');
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);

    const input = { shift_id: shift.shift_id };
    console.log('[test-input] postSwapShift not-your-shift:', input);

    await expect(postSwapShift('sub-emp', input)).rejects.toThrow(/only post your own shifts/i);
  });

  it('throws ValidationError when shift status is draft (not published)', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id, { status: 'draft' });
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);

    await expect(postSwapShift('sub-emp', { shift_id: shift.shift_id })).rejects.toThrow(
      /Only published shifts/i,
    );
  });

  it('throws ValidationError when shift date is in the past', async () => {
    const caller = makeCallerLookup();
    // Date set to well in the past.
    const shift = makeShift(caller.org_id, caller.employee_id, { date: '2020-01-01' });
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);

    await expect(postSwapShift('sub-emp', { shift_id: shift.shift_id })).rejects.toThrow(
      /Cannot post a past shift/i,
    );
  });

  it('boundary: shift date = today is treated as NOT past (allowed)', async () => {
    const caller = makeCallerLookup();
    const today = new Date().toISOString().slice(0, 10);
    const shift = makeShift(caller.org_id, caller.employee_id, { date: today });
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(
      makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id) as never,
    );

    // Should NOT throw — today is not < today.
    const result = await postSwapShift('sub-emp', { shift_id: shift.shift_id });
    expect(result).toHaveProperty('date', today);
  });
});

describe('postSwapShift — duplicate guard', () => {
  it('throws ConflictError when an open swap already exists for this shift', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id);
    const existingSwap = makeSwap(caller.org_id, caller.employee_id, {
      shift_id: shift.shift_id,
    });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(existingSwap as never);

    const input = { shift_id: shift.shift_id };
    console.log('[test-input] postSwapShift duplicate-guard:', input);

    await expect(postSwapShift('sub-emp', input)).rejects.toThrow(
      /already posted for swap/i,
    );
  });
});

describe('postSwapShift — employee record guard', () => {
  it('throws ForbiddenError when EMPLOYEE# primary record is missing (belt-and-suspenders)', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id);
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(null);

    await expect(postSwapShift('sub-emp', { shift_id: shift.shift_id })).rejects.toThrow(
      /Employee record not found/i,
    );
  });
});

describe('postSwapShift — happy path', () => {
  it('creates SWAP# record, writes to DB, and returns stripped swap shape', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id);
    const employeeRecord = makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id);

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(employeeRecord as never);

    const input = { shift_id: shift.shift_id };
    console.log('[test-input] postSwapShift happy-path:', input, 'caller:', caller.employee_id);

    const result = await postSwapShift('sub-emp', input);

    // putSwap was called once.
    expect(db.putSwap).toHaveBeenCalledTimes(1);

    // Returned record has the correct shape and no DynamoDB key fields.
    expect(result).not.toHaveProperty('PK');
    expect(result).not.toHaveProperty('SK');
    expect(result).not.toHaveProperty('GSI1PK');
    expect(result).not.toHaveProperty('GSI1SK');
    expect(result).toHaveProperty('shift_id', shift.shift_id);
    expect(result).toHaveProperty('status', 'open');
    expect(result).toHaveProperty('posted_by_employee_id', caller.employee_id);
    expect(result).toHaveProperty('posted_by_employee_name', `${caller.first_name} ${caller.last_name}`);
  });

  it('denormalizes shift date/time fields onto the SWAP# record', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id, {
      date: '2026-09-10',
      start_time: '08:00',
      end_time: '16:00',
    });
    const employeeRecord = makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id);

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(employeeRecord as never);

    const result = await postSwapShift('sub-emp', { shift_id: shift.shift_id });

    expect(result).toHaveProperty('date', '2026-09-10');
    expect(result).toHaveProperty('start_time', '08:00');
    expect(result).toHaveProperty('end_time', '16:00');
  });
});

describe('postSwapShift — manager notification', () => {
  it('calls putNotification with message containing employee name and shift date/time after post', async () => {
    const caller = makeCallerLookup({ first_name: 'Alice', last_name: 'Worker' });
    const shift = makeShift(caller.org_id, caller.employee_id, {
      date: '2026-09-05',
      start_time: '09:00',
      end_time: '17:00',
    });
    const employeeRecord = makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id);

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(employeeRecord as never);

    console.log('[test-input] postSwapShift notification: employee=Alice Worker, shift=2026-09-05 09:00–17:00');

    await postSwapShift('sub-emp', { shift_id: shift.shift_id });

    // Allow microtask queue to flush (void tryNotifyManager is async).
    await Promise.resolve();

    expect(putNotification).toHaveBeenCalledTimes(1);
    const notif = vi.mocked(putNotification).mock.calls[0][0];
    expect(notif.message).toContain('Alice Worker');
    expect(notif.message).toContain('2026-09-05');
    expect(notif.message).toContain('09:00');
    expect(notif.message).toContain('17:00');
    expect(notif.recipient_sub).toBe(caller.manager_id);
  });

  it('notification failure does not fail postSwapShift (returns 200-equivalent data)', async () => {
    const caller = makeCallerLookup();
    const shift = makeShift(caller.org_id, caller.employee_id);
    const employeeRecord = makeEmployeeRecord(caller.org_id, caller.employee_id, caller.manager_id);

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getShiftById).mockResolvedValue(shift as never);
    vi.mocked(db.findOpenSwapForShift).mockResolvedValue(null);
    vi.mocked(db.getEmployeeByIdInOrg).mockResolvedValue(employeeRecord as never);
    // Simulate DynamoDB blip on notification write.
    vi.mocked(putNotification).mockRejectedValue(new Error('DynamoDB timeout'));

    // Service must resolve successfully despite notification failure.
    const result = await postSwapShift('sub-emp', { shift_id: shift.shift_id });

    expect(result).toHaveProperty('shift_id', shift.shift_id);
    expect(result).toHaveProperty('status', 'open');

    // Flush the void tryNotifyManager promise.
    await Promise.resolve();
    // putNotification was still called (and threw), but the service didn't re-throw.
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// claimSwapShift
// ═════════════════════════════════════════════════════════════════════════════

describe('claimSwapShift — input validation', () => {
  it('throws ValidationError when swapId contains forbidden characters', async () => {
    await expect(claimSwapShift('sub-emp', '../../../etc/passwd')).rejects.toThrow(
      /swapId must contain only/i,
    );
  });

  it('throws ValidationError when swapId is empty', async () => {
    await expect(claimSwapShift('sub-emp', '')).rejects.toThrow(/swapId path parameter is required/i);
  });

  it('throws ValidationError when swapId exceeds 128 characters', async () => {
    const tooLong = 'a'.repeat(129);
    await expect(claimSwapShift('sub-emp', tooLong)).rejects.toThrow(/swapId must contain only/i);
  });
});

describe('claimSwapShift — caller resolution', () => {
  it('throws ForbiddenError when caller not provisioned', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(claimSwapShift('sub-ghost', pick(SWAP_ID_POOL))).rejects.toThrow(
      /Caller could not be resolved/,
    );
  });
});

describe('claimSwapShift — swap lookup and auth', () => {
  it('throws NotFoundError when swap does not exist (missing or cross-org)', async () => {
    const caller = makeCallerLookup();
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(null);

    const swapId = pick(SWAP_ID_POOL);
    console.log('[test-input] claimSwapShift not-found: swapId=', swapId, 'caller.org=', caller.org_id);

    await expect(claimSwapShift('sub-emp', swapId)).rejects.toThrow(/Swap listing not found/);
  });

  it('returns 404 (not 403) for cross-org claim — existence must not be revealed', async () => {
    // When DB is org-scoped, cross-org swap ID returns null → NotFoundError, not ForbiddenError.
    const caller = makeCallerLookup();
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(null);

    const swapId = pick(SWAP_ID_POOL);
    const err = await claimSwapShift('sub-emp', swapId).catch((e: Error) => e);

    expect(err.constructor.name).toBe('NotFoundError');
    // Explicitly confirm it's NOT ForbiddenError.
    expect(err.constructor.name).not.toBe('ForbiddenError');
  });

  it('throws ForbiddenError on self-claim (caller is the poster)', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-poster' });
    const swap = makeSwap(caller.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    console.log('[test-input] claimSwapShift self-claim: caller.employee_id=emp-poster, swap.posted_by=emp-poster');

    await expect(claimSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(/cannot claim your own/i);
  });

  it('throws ConflictError when swap is already claimed', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-other' });
    const swap = makeSwap(caller.org_id, 'emp-poster', {
      status: 'claimed',
      claimed_by_employee_id: 'emp-first-claimer',
      claimed_by_employee_name: 'First Claimer',
    });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    await expect(claimSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(
      /no longer available/i,
    );
  });

  it('throws ConflictError when swap is cancelled', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-claimer' });
    const swap = makeSwap(caller.org_id, 'emp-poster', { status: 'cancelled' });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    await expect(claimSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(/no longer available/i);
  });
});

describe('claimSwapShift — happy path', () => {
  it('calls claimSwapAndTransferShift and returns claimed swap with keys stripped', async () => {
    const caller = makeCallerLookup({
      employee_id: 'emp-claimer',
      first_name: 'Bob',
      last_name: 'Claimer',
    });
    const swap = makeSwap(caller.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    console.log('[test-input] claimSwapShift happy-path: claimer=Bob Claimer, poster=emp-poster, swapId=', swap.swap_id);

    const result = await claimSwapShift('sub-claimer', swap.swap_id);

    expect(db.claimSwapAndTransferShift).toHaveBeenCalledWith(
      caller.org_id,
      swap.swap_id,
      swap.shift_id,
      swap.created_at,
      { employee_id: caller.employee_id, employee_name: 'Bob Claimer' },
    );

    expect(result).toHaveProperty('status', 'claimed');
    expect(result).toHaveProperty('claimed_by_employee_id', 'emp-claimer');
    expect(result).toHaveProperty('claimed_by_employee_name', 'Bob Claimer');
    expect(result).not.toHaveProperty('PK');
    expect(result).not.toHaveProperty('SK');
    expect(result).not.toHaveProperty('GSI1PK');
    expect(result).not.toHaveProperty('GSI1SK');
  });
});

describe('claimSwapShift — manager notification', () => {
  it('calls putNotification with message containing claimer name, poster name, and shift date/time', async () => {
    const caller = makeCallerLookup({
      employee_id: 'emp-claimer',
      first_name: 'Carlos',
      last_name: 'Taker',
    });
    const swap = makeSwap(caller.org_id, 'emp-poster', {
      posted_by_employee_name: 'Diana Poster',
      date: '2026-09-20',
      start_time: '10:00',
      end_time: '18:00',
    });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    console.log('[test-input] claimSwapShift notification: claimer=Carlos Taker, poster=Diana Poster');

    await claimSwapShift('sub-claimer', swap.swap_id);
    await Promise.resolve();

    expect(putNotification).toHaveBeenCalledTimes(1);
    const notif = vi.mocked(putNotification).mock.calls[0][0];
    expect(notif.message).toContain('Carlos Taker');
    expect(notif.message).toContain('Diana Poster');
    expect(notif.message).toContain('2026-09-20');
    expect(notif.message).toContain('10:00');
    expect(notif.message).toContain('18:00');
  });

  it('notification failure does not fail claimSwapShift (response still succeeds)', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-claimer' });
    const swap = makeSwap(caller.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);
    vi.mocked(putNotification).mockRejectedValue(new Error('notification write timeout'));

    // Must succeed even when putNotification throws.
    const result = await claimSwapShift('sub-claimer', swap.swap_id);
    await Promise.resolve();

    expect(result).toHaveProperty('status', 'claimed');
  });
});

describe('claimSwapShift — race condition simulation', () => {
  it('second concurrent claim on same swapId gets ConflictError when DynamoDB throws ConditionalCheckFailedException', async () => {
    /**
     * Simulate: callerA and callerB both try to claim the same swap simultaneously.
     * Both reads return status='open'. callerA's write succeeds.
     * callerB's write throws ConditionalCheckFailedException (the real DynamoDB
     * behavior when the ConditionExpression `#status = :open` fails because callerA
     * already updated the status to 'claimed').
     * The service must catch that exception and surface it as ConflictError (409).
     */
    const callerA = makeCallerLookup({ employee_id: 'emp-claimer-a' });
    const callerB = makeCallerLookup({ employee_id: 'emp-claimer-b', org_id: callerA.org_id });
    const swap = makeSwap(callerA.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup)
      .mockResolvedValueOnce(callerA)
      .mockResolvedValueOnce(callerB);

    // Both reads return status='open' (simulating the race window before the write).
    vi.mocked(db.getSwapById)
      .mockResolvedValueOnce(swap as never)
      .mockResolvedValueOnce(swap as never);

    // callerA's write succeeds; callerB's write throws ConditionalCheckFailedException.
    const conditionalCheckError = Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });
    vi.mocked(db.claimSwapAndTransferShift)
      .mockResolvedValueOnce(undefined) // callerA wins
      .mockRejectedValueOnce(conditionalCheckError); // callerB loses

    const [resultA, resultB] = await Promise.allSettled([
      claimSwapShift('sub-a', swap.swap_id),
      claimSwapShift('sub-b', swap.swap_id),
    ]);

    // callerA should succeed.
    expect(resultA.status).toBe('fulfilled');

    // callerB should get ConflictError (mapped from ConditionalCheckFailedException → 409).
    expect(resultB.status).toBe('rejected');
    if (resultB.status === 'rejected') {
      expect(resultB.reason.constructor.name).toBe('ConflictError');
      expect((resultB.reason as Error).message).toMatch(/no longer available/i);
    }
  });

  it('re-throws non-conditional DynamoDB errors from claimSwapAndTransferShift', async () => {
    /**
     * Only ConditionalCheckFailedException should be caught and mapped to ConflictError.
     * Other DynamoDB errors (e.g. provisioned throughput exceeded) must propagate so
     * the handler returns 500 rather than silently converting them to 409.
     */
    const caller = makeCallerLookup({ employee_id: 'emp-claimer' });
    const swap = makeSwap(caller.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    const throughputError = Object.assign(
      new Error('Provisioned throughput exceeded'),
      { name: 'ProvisionedThroughputExceededException' },
    );
    vi.mocked(db.claimSwapAndTransferShift).mockRejectedValue(throughputError);

    await expect(claimSwapShift('sub-claimer', swap.swap_id)).rejects.toThrow(
      /Provisioned throughput exceeded/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// cancelSwapShift
// ═════════════════════════════════════════════════════════════════════════════

describe('cancelSwapShift — input validation', () => {
  it('throws ValidationError when swapId contains special characters', async () => {
    await expect(cancelSwapShift('sub-emp', 'swap/../../etc')).rejects.toThrow(
      /swapId must contain only/i,
    );
  });

  it('throws ValidationError when swapId is empty', async () => {
    await expect(cancelSwapShift('sub-emp', '')).rejects.toThrow(/swapId path parameter is required/i);
  });
});

describe('cancelSwapShift — caller resolution', () => {
  it('throws ForbiddenError when caller not provisioned', async () => {
    vi.mocked(db.getCallerLookup).mockResolvedValue(null);

    await expect(cancelSwapShift('sub-ghost', pick(SWAP_ID_POOL))).rejects.toThrow(
      /Caller could not be resolved/,
    );
  });
});

describe('cancelSwapShift — swap validation', () => {
  it('throws NotFoundError when swap does not exist', async () => {
    const caller = makeCallerLookup();
    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(null);

    const swapId = pick(SWAP_ID_POOL);
    console.log('[test-input] cancelSwapShift not-found: swapId=', swapId);

    await expect(cancelSwapShift('sub-emp', swapId)).rejects.toThrow(/Swap listing not found/);
  });

  it('throws ForbiddenError when caller is not the poster', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-not-poster' });
    const swap = makeSwap(caller.org_id, 'emp-actual-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    console.log('[test-input] cancelSwapShift wrong-caller: caller=emp-not-poster, poster=emp-actual-poster');

    await expect(cancelSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(
      /only cancel your own/i,
    );
  });

  it('throws ConflictError when listing is already claimed', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-poster' });
    const swap = makeSwap(caller.org_id, 'emp-poster', { status: 'claimed' });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    await expect(cancelSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(
      /no longer open/i,
    );
  });

  it('throws ConflictError when listing is already cancelled', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-poster' });
    const swap = makeSwap(caller.org_id, 'emp-poster', { status: 'cancelled' });

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    await expect(cancelSwapShift('sub-emp', swap.swap_id)).rejects.toThrow(/no longer open/i);
  });
});

describe('cancelSwapShift — happy path', () => {
  it('calls cancelSwap with correct org/swapId/createdAt and resolves void', async () => {
    const caller = makeCallerLookup({ employee_id: 'emp-poster' });
    const swap = makeSwap(caller.org_id, 'emp-poster');

    vi.mocked(db.getCallerLookup).mockResolvedValue(caller);
    vi.mocked(db.getSwapById).mockResolvedValue(swap as never);

    console.log('[test-input] cancelSwapShift happy-path: swapId=', swap.swap_id, 'org=', caller.org_id);

    const result = await cancelSwapShift('sub-emp', swap.swap_id);

    expect(result).toBeUndefined();
    expect(db.cancelSwap).toHaveBeenCalledWith(caller.org_id, swap.swap_id, swap.created_at);
    expect(db.cancelSwap).toHaveBeenCalledTimes(1);
  });
});
