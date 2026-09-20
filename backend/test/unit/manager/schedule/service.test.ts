/**
 * Unit tests for the manager schedule service — focused on the draft_failed
 * sentinel record behavior introduced in Story #333.
 *
 * Covers:
 *   - draft_failed existing shifts are excluded from filledCounts so slots are
 *     retried on re-runs rather than treated as already filled.
 *   - When no candidate is found, a sentinel PutItem is written with the
 *     correct deterministic SK, and draftFailed counter increments.
 *   - Happy path: a fillable slot creates a normal draft shift, no sentinel.
 *   - Early-exit paths (no shifts needed, no employees) return draftFailed: 0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all db dependencies before importing the service under test.
vi.mock('../../../../src/functions/manager/schedule/db.js', () => ({
  getCallerLookup: vi.fn(),
  getScheduleMeta: vi.fn(),
  listAllShiftsByManager: vi.fn(),
  getEmployeeAvailability: vi.fn(),
  getEmployeeAvailabilityOverrides: vi.fn(),
  upsertScheduleMeta: vi.fn(),
  createShift: vi.fn(),
}));

vi.mock('../../../../src/functions/manager/shifts-needed/db.js', () => ({
  listShifts: vi.fn(),
}));

vi.mock('../../../../src/functions/manager/employees/db.js', () => ({
  listEmployeesByManager: vi.fn(),
}));

import type { ShiftNeeded } from '../../../../src/functions/shared/models/manager/shift-needed.model.js';
import type { Employee } from '../../../../src/functions/shared/models/org-admin/employee.model.js';
import { generateDraftSchedule } from '../../../../src/functions/manager/schedule/service.js';
import * as db from '../../../../src/functions/manager/schedule/db.js';
import * as shiftsNeededDb from '../../../../src/functions/manager/shifts-needed/db.js';
import * as employeesDb from '../../../../src/functions/manager/employees/db.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal caller metadata returned by getCallerLookup. */
const CALLER = { org_id: 'org-1', manager_id: 'mgr-1' };

/**
 * A shift-needed slot requiring one employee. Only the fields the scheduler reads are
 * populated, so the fixture is asserted (not built) as the full stored record.
 */
const SLOT = {
  date: '2026-07-01',
  location_id: 'loc-1',
  location_name: 'Main Floor',
  start_time: '09:00',
  end_time: '17:00',
  employee_count: 1,
} as ShiftNeeded;

/** A minimal employee record (fields the scheduler reads only; see SLOT). */
const EMPLOYEE = {
  employee_id: 'emp-1',
  first_name: 'Alice',
  last_name: 'Smith',
  manager_id: 'mgr-1',
  org_id: 'org-1',
} as Employee;

/** Weekly availability that covers the wednesday 2026-07-01 slot (09:00-17:00). */
const WEEKLY_AVAIL = {
  wednesday: {
    available: true,
    slots: [{ from: '08:00', to: '18:00' }],
    max_shifts: 1,
  },
};

/** A draft_failed sentinel record for SLOT. */
const DRAFT_FAILED_SHIFT = {
  PK: 'ORG#org-1',
  SK: 'SHIFT#FAILED#mgr-1#2026-07-01#loc-1#09:00#17:00',
  GSI1PK: 'MANAGER#mgr-1',
  GSI1SK: '2026-07-01',
  shift_id: 'FAILED#mgr-1#2026-07-01#loc-1#09:00#17:00',
  org_id: 'org-1',
  manager_id: 'mgr-1',
  employee_id: '',
  employee_name: '',
  location_id: 'loc-1',
  location_name: 'Main Floor',
  date: '2026-07-01',
  start_time: '09:00',
  end_time: '17:00',
  type: 'morning',
  status: 'draft_failed',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getCallerLookup).mockResolvedValue(CALLER);
  vi.mocked(db.getScheduleMeta).mockResolvedValue(null); // fresh month, 0 drafts
  vi.mocked(db.createShift).mockResolvedValue(undefined);
  vi.mocked(db.upsertScheduleMeta).mockResolvedValue(undefined);
  vi.mocked(db.getEmployeeAvailability).mockResolvedValue(null);
  vi.mocked(db.getEmployeeAvailabilityOverrides).mockResolvedValue(null);
});

// ─── Randomised slot pool (seeded for reproducibility) ───────────────────────

/**
 * Pool of shift slots used in randomised tests.
 * Each entry is an independently fillable slot on a distinct date/location pair.
 * 2026-07-01 is a Wednesday; 2026-07-02 is a Thursday; 2026-07-07 is a Tuesday.
 */
const SLOT_POOL = [
  { date: '2026-07-01', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 },
  { date: '2026-07-02', location_id: 'loc-2', location_name: 'Back Office', start_time: '08:00', end_time: '16:00', employee_count: 1 },
  { date: '2026-07-07', location_id: 'loc-1', location_name: 'Main Floor', start_time: '13:00', end_time: '21:00', employee_count: 1 },
];

const WEEKLY_AVAIL_BROAD = {
  wednesday: { available: true, slots: [{ from: '07:00', to: '22:00' }], max_shifts: 1 },
  thursday:  { available: true, slots: [{ from: '07:00', to: '22:00' }], max_shifts: 1 },
  tuesday:   { available: true, slots: [{ from: '07:00', to: '22:00' }], max_shifts: 1 },
};

// ─── draft_failed exclusion from filledCounts ─────────────────────────────────

describe('generateDraftSchedule — draft_failed exclusion from filledCounts', () => {
  it('does not count a draft_failed sentinel as filling a slot, so the slot is still attempted', async () => {
    // Pre-existing sentinel for the same slot — should NOT count as filled.
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([DRAFT_FAILED_SHIFT as never]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    // Employee is available for the slot this time.
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // Slot was attempted and filled — a normal draft shift PutItem should be called.
    expect(db.createShift).toHaveBeenCalledTimes(1);
    const written = vi.mocked(db.createShift).mock.calls[0][0];
    expect(written.status).toBe('draft');
    expect(written.employee_id).toBe('emp-1');
    expect(result.created).toBe(1);
    expect(result.draftFailed).toBe(0);
  });

  it('counts a normal draft shift as filling a slot so it is not double-assigned', async () => {
    // Pre-existing filled draft shift for the same slot.
    const existingDraft = {
      ...DRAFT_FAILED_SHIFT,
      SK: 'SHIFT#some-uuid',
      shift_id: 'some-uuid',
      status: 'draft',
      employee_id: 'emp-1',
      employee_name: 'Alice Smith',
    };
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([existingDraft as never]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // Slot is already filled — no new PutItem for a shift.
    expect(db.createShift).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.unfilled).toBe(0);
  });
});

// ─── Sentinel record written when no candidate found ──────────────────────────

describe('generateDraftSchedule — sentinel PutItem when no candidate', () => {
  it('writes a draft_failed sentinel with the correct deterministic SK when no employee is available', async () => {
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    // Employee has NO availability — no candidate will be found.
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue(null);

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    expect(db.createShift).toHaveBeenCalledTimes(1);
    const written = vi.mocked(db.createShift).mock.calls[0][0];
    // Verify the deterministic SK format.
    expect(written.SK).toBe('SHIFT#FAILED#mgr-1#2026-07-01#loc-1#09:00#17:00');
    expect(written.shift_id).toBe('FAILED#mgr-1#2026-07-01#loc-1#09:00#17:00');
    // Verify sentinel field values.
    expect(written.status).toBe('draft_failed');
    expect(written.employee_id).toBe('');
    expect(written.employee_name).toBe('');
    expect(written.location_id).toBe('loc-1');
    expect(written.date).toBe('2026-07-01');
    expect(written.start_time).toBe('09:00');
    expect(written.end_time).toBe('17:00');
    expect(written.GSI1PK).toBe('MANAGER#mgr-1');
    expect(written.GSI1SK).toBe('2026-07-01');
    // Counters must reflect the failure.
    expect(result.created).toBe(0);
    expect(result.unfilled).toBe(1);
    expect(result.draftFailed).toBe(1);
  });

  it('increments draftFailed once per unfillable slot, not once per re-run attempt', async () => {
    // Two separate slots — both unfillable.
    const slot2 = { ...SLOT, date: '2026-07-02', location_id: 'loc-2' };
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT, slot2]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue(null); // no availability

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // Two sentinels, two draftFailed.
    expect(db.createShift).toHaveBeenCalledTimes(2);
    expect(result.draftFailed).toBe(2);
    expect(result.unfilled).toBe(2);
  });

  it('uses PutItem (createShift) which overwrites on re-run — same SK, idempotent', async () => {
    // Simulate re-run: sentinel already exists from a previous run.
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([DRAFT_FAILED_SHIFT as never]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    // Still no candidate on re-run.
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue(null);

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // createShift is called (PutItem overwrites), same SK as before.
    expect(db.createShift).toHaveBeenCalledTimes(1);
    const written = vi.mocked(db.createShift).mock.calls[0][0];
    expect(written.SK).toBe('SHIFT#FAILED#mgr-1#2026-07-01#loc-1#09:00#17:00');
    expect(result.draftFailed).toBe(1);
  });
});

// ─── Happy path: slot filled, no sentinel ─────────────────────────────────────

describe('generateDraftSchedule — happy path (slot filled)', () => {
  it('creates a draft shift with employee data and does not write a sentinel', async () => {
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    expect(db.createShift).toHaveBeenCalledTimes(1);
    const written = vi.mocked(db.createShift).mock.calls[0][0];
    expect(written.status).toBe('draft');
    expect(written.employee_id).toBe('emp-1');
    expect(result.created).toBe(1);
    expect(result.unfilled).toBe(0);
    expect(result.draftFailed).toBe(0);
  });

  it('returns draftFailed: 0 in the response shape', async () => {
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL });

    const result = await generateDraftSchedule('caller-sub', '2026-07');
    expect(result).toHaveProperty('draftFailed', 0);
  });
});

// ─── Early-exit paths return draftFailed: 0 ───────────────────────────────────

describe('generateDraftSchedule — early-exit paths', () => {
  it('returns draftFailed: 0 when there are no shifts needed', async () => {
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);

    const result = await generateDraftSchedule('caller-sub', '2026-07');
    expect(result.draftFailed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.unfilled).toBe(0);
  });

  it('returns draftFailed: 0 when there are no employees', async () => {
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([]);

    const result = await generateDraftSchedule('caller-sub', '2026-07');
    expect(result.draftFailed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.unfilled).toBe(1);
  });

  it('throws ValidationError when draft limit is reached', async () => {
    vi.mocked(db.getScheduleMeta).mockResolvedValue({
      PK: 'ORG#org-1',
      SK: 'SCHEDULE_META#mgr-1#2026-07',
      org_id: 'org-1',
      manager_id: 'mgr-1',
      month: '2026-07',
      draft_count: 10,
      updated_at: '2026-07-01T00:00:00.000Z',
    });
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);

    await expect(generateDraftSchedule('caller-sub', '2026-07')).rejects.toThrow(
      /Maximum of 10 draft generations/,
    );
  });
});

// ─── Mixed outcome (adversarial) ──────────────────────────────────────────────

describe('generateDraftSchedule — mixed outcome: some slots filled, some not', () => {
  it('fills fillable slots and writes sentinels for unfillable ones in the same run', async () => {
    // SLOT (2026-07-01 Wed) is fillable — employee has Wed availability.
    // SLOT_POOL[2] (2026-07-07 Tue) is fillable — employee has Tue availability.
    // SLOT_POOL[1] (2026-07-02 Thu) uses loc-2 and employee ALSO has Thu availability,
    // but we mark employee_count:2 so one fills and one fails (only one employee exists).
    const twoPersonSlot = { ...SLOT_POOL[1], employee_count: 2 };

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT, twoPersonSlot] as ShiftNeeded[]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    // Employee has broad availability covering Wed and Thu
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL_BROAD });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // SLOT (Wed, 1 needed) — 1 draft shift created
    // twoPersonSlot (Thu, 2 needed) — 1 draft + 1 draft_failed (only 1 employee)
    expect(result.created).toBe(2);
    expect(result.draftFailed).toBe(1);
    expect(result.unfilled).toBe(1);

    // Verify the calls: 3 total (2 drafts + 1 sentinel)
    expect(db.createShift).toHaveBeenCalledTimes(3);

    const calls = vi.mocked(db.createShift).mock.calls;
    const statuses = calls.map((c) => c[0].status);
    expect(statuses.filter((s) => s === 'draft').length).toBe(2);
    expect(statuses.filter((s) => s === 'draft_failed').length).toBe(1);
  });

  it('sentinel SK for the mixed run uses the correct deterministic format', async () => {
    const twoPersonSlot = { ...SLOT_POOL[1], employee_count: 2 };

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([twoPersonSlot] as ShiftNeeded[]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL_BROAD });

    await generateDraftSchedule('caller-sub', '2026-07');

    const sentinelCall = vi.mocked(db.createShift).mock.calls.find(
      (c) => c[0].status === 'draft_failed',
    );
    expect(sentinelCall).toBeDefined();
    // SK must encode manager, date, location, times deterministically
    expect(sentinelCall![0].SK).toBe(
      `SHIFT#FAILED#mgr-1#${SLOT_POOL[1].date}#${SLOT_POOL[1].location_id}#${SLOT_POOL[1].start_time}#${SLOT_POOL[1].end_time}`,
    );
    expect(sentinelCall![0].employee_id).toBe('');
    expect(sentinelCall![0].employee_name).toBe('');
  });
});

// ─── max_shifts per-day cap causes draft_failed (adversarial) ────────────────

describe('generateDraftSchedule — max_shifts cap produces draft_failed', () => {
  it('writes draft_failed when employee is available but max_shifts is already consumed', async () => {
    // Employee availability allows only 1 shift per day on Wednesday.
    // We feed two slots on 2026-07-01 (Wed) — employee fills slot 1, then hits cap.
    const slotA = { ...SLOT, start_time: '09:00', end_time: '13:00' };
    const slotB = { ...SLOT, start_time: '14:00', end_time: '18:00' };

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([slotA, slotB]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    // max_shifts: 1 — employee can fill exactly one shift on a given day
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({
      schedule: {
        wednesday: {
          available: true,
          slots: [{ from: '08:00', to: '22:00' }],
          max_shifts: 1,
        },
      },
    });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // slotA filled, slotB gets draft_failed (max_shifts exhausted)
    expect(result.created).toBe(1);
    expect(result.draftFailed).toBe(1);
    expect(result.unfilled).toBe(1);

    const calls = vi.mocked(db.createShift).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0].status).toBe('draft');
    expect(calls[0][0].employee_id).toBe('emp-1');
    expect(calls[1][0].status).toBe('draft_failed');
    expect(calls[1][0].employee_id).toBe('');
  });

  /**
   * NOTE — 40-hr weekly cap: the backend draft-generation service does NOT
   * enforce a 40-hr/week hard cap during scheduling. The per-day max_shifts limit
   * from the employee's availability record is the only scheduling constraint
   * enforced here. The 39-hr advisory check exists only in the frontend fill-shift
   * UI (schedule.ts > weeklyHoursForEmployee). This is flagged as
   * "unconfirmed — needs human review": was a backend 40-hr cap intentionally
   * omitted from the scheduler, or is it a gap?
   */
  it('does NOT enforce a 40-hr weekly cap during draft generation (documents current behaviour)', async () => {
    // Employee is available every day with max_shifts:1, giving ≥40hrs/week.
    // Assign 6 days × 8h = 48h in a single run — service should NOT reject any slot.
    const slots = [
      { date: '2026-07-06', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Mon
      { date: '2026-07-07', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Tue
      { date: '2026-07-08', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Wed
      { date: '2026-07-09', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Thu
      { date: '2026-07-10', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Fri
      { date: '2026-07-11', location_id: 'loc-1', location_name: 'Main Floor', start_time: '09:00', end_time: '17:00', employee_count: 1 }, // Sat
    ];

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue(slots as ShiftNeeded[]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({
      schedule: {
        monday:    { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
        tuesday:   { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
        wednesday: { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
        thursday:  { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
        friday:    { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
        saturday:  { available: true, slots: [{ from: '08:00', to: '18:00' }], max_shifts: 1 },
      },
    });

    const result = await generateDraftSchedule('caller-sub', '2026-07');

    // Documents that all 6 slots are filled (48hr week) — no 40-hr cap in backend.
    // If a cap is added in future, this test should be updated to reflect the new behaviour.
    expect(result.created).toBe(6);
    expect(result.draftFailed).toBe(0);
  });
});

// ─── Randomised input pool ─────────────────────────────────────────────────────

describe('generateDraftSchedule — randomised slot selection', () => {
  /**
   * Draws a random slot from SLOT_POOL per run. Employee has availability
   * covering all days in SLOT_POOL. Asserts the slot is always filled.
   * Seed = floor(Date.now() / 30000) — deterministic per ~30s window.
   * On failure, the slot details are embedded in the error message.
   */
  it('fills a randomly selected slot from the pool when employee is available', async () => {
    const seed = Math.floor(Date.now() / 30000);
    const slot = SLOT_POOL[seed % SLOT_POOL.length];

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([slot] as ShiftNeeded[]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL_BROAD });

    let result: Awaited<ReturnType<typeof generateDraftSchedule>> | undefined;
    try {
      result = await generateDraftSchedule('caller-sub', '2026-07');
    } catch (err) {
      throw new Error(
        `generateDraftSchedule failed for slot=${JSON.stringify(slot)} seed=${seed}: ${err}`,
      );
    }

    expect(result!.created).toBe(1);
    expect(result!.draftFailed).toBe(0);

    const written = vi.mocked(db.createShift).mock.calls[0][0];
    expect(written.status).toBe('draft');
    expect(written.employee_id).toBe('emp-1');
    expect(written.date).toBe(slot.date);
    expect(written.location_id).toBe(slot.location_id);
    expect(written.start_time).toBe(slot.start_time);
  });

  it('writes draft_failed for a randomly selected slot when employee has NO availability', async () => {
    const seed = Math.floor(Date.now() / 30000) + 1; // offset to pick a different slot each window
    const slot = SLOT_POOL[seed % SLOT_POOL.length];

    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([slot] as ShiftNeeded[]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue(null); // no availability

    let result: Awaited<ReturnType<typeof generateDraftSchedule>> | undefined;
    try {
      result = await generateDraftSchedule('caller-sub', '2026-07');
    } catch (err) {
      throw new Error(
        `generateDraftSchedule failed for slot=${JSON.stringify(slot)} seed=${seed}: ${err}`,
      );
    }

    expect(result!.draftFailed).toBe(1);
    expect(result!.created).toBe(0);

    const written = vi.mocked(db.createShift).mock.calls[0][0];
    expect(written.status).toBe('draft_failed');
    expect(written.employee_id).toBe('');
    expect(written.date).toBe(slot.date);
  });
});

// ─── Boundary: exactly-at-limit cases ─────────────────────────────────────────

describe('generateDraftSchedule — boundary: draft count exactly at MAX_DRAFTS - 1', () => {
  it('succeeds when draft count is exactly MAX_DRAFTS - 1 (9), refuses at 10', async () => {
    // At count=9 it should proceed and increment to 10
    vi.mocked(db.getScheduleMeta).mockResolvedValue({
      PK: 'ORG#org-1',
      SK: 'SCHEDULE_META#mgr-1#2026-07',
      org_id: 'org-1',
      manager_id: 'mgr-1',
      month: '2026-07',
      draft_count: 9,
      updated_at: '2026-07-01T00:00:00.000Z',
    });
    vi.mocked(db.listAllShiftsByManager).mockResolvedValue([]);
    vi.mocked(shiftsNeededDb.listShifts).mockResolvedValue([SLOT]);
    vi.mocked(employeesDb.listEmployeesByManager).mockResolvedValue([EMPLOYEE]);
    vi.mocked(db.getEmployeeAvailability).mockResolvedValue({ schedule: WEEKLY_AVAIL });

    const result = await generateDraftSchedule('caller-sub', '2026-07');
    expect(result.draftCount).toBe(10);
    expect(result.maxDrafts).toBe(10);
  });
});
