import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import { listShifts as listShiftsNeeded } from '../../manager/shifts-needed/db.js';
import { listEmployeesByManager } from '../../manager/employees/db.js';
import type { Employee } from '../../shared/models/org-admin/employee.model.js';
import type { Shift, ShiftType } from '../../shared/models/manager/shift.model.js';
import type {
  WeeklySchedule,
  DayAvailability,
  DayOfWeek,
  DateOverrides,
} from '../../shared/models/employee/availability.model.js';
import * as db from './db.js';

const MAX_DRAFTS = 10;

import { ValidationError, ForbiddenError } from '../../shared/errors.js';
import type { ManagerScheduleDraftsResponse } from '@daltime/contracts';

const DAY_NAMES: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function parseMonth(raw: string | undefined): string {
  const m = raw ?? currentMonthString();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new ValidationError('month must be in YYYY-MM format');
  return m;
}

function currentMonthString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function inferType(startTime: string): ShiftType {
  const hour = Number.parseInt(startTime.split(':')[0], 10);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'night';
}

function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days: string[] = [];
  const d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) {
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

function dayOfWeek(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(shiftStart: string, shiftEnd: string, slotFrom: string, slotTo: string): boolean {
  return (
    timeToMinutes(slotFrom) <= timeToMinutes(shiftStart) &&
    timeToMinutes(slotTo) >= timeToMinutes(shiftEnd)
  );
}

function effectiveAvailability(
  date: string,
  weekly: WeeklySchedule | null,
  overrides: DateOverrides | null,
): DayAvailability | null {
  if (overrides?.[date]) return overrides[date];
  if (!weekly) return null;
  return weekly[dayOfWeek(date)] ?? null;
}

function isAvailableForShift(
  avail: DayAvailability | null,
  shiftStart: string,
  shiftEnd: string,
): boolean {
  if (!avail?.available) return false;
  if (!avail.slots?.length) return false;
  return avail.slots.some((s) => overlaps(shiftStart, shiftEnd, s.from, s.to));
}

/** Count how many days in the month an employee has any availability at all. */
function countAvailableDays(
  monthDates: string[],
  weekly: WeeklySchedule | null,
  overrides: DateOverrides | null,
): number {
  let count = 0;
  for (const date of monthDates) {
    const avail = effectiveAvailability(date, weekly, overrides);
    if (avail?.available && avail.slots?.length) count++;
  }
  return count;
}

interface EmployeeData {
  employee: Employee;
  weekly: WeeklySchedule | null;
  overrides: DateOverrides | null;
  availableDays: number;
}

async function resolveCallerOrg(sub: string) {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function generateDraftSchedule(
  callerSub: string,
  rawMonth: string | undefined,
): Promise<{
  created: number;
  unfilled: number;
  draftFailed: number;
  draftCount: number;
  maxDrafts: number;
}> {
  const month = parseMonth(rawMonth);
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  // Enforce 10-draft limit per manager per month
  const meta = await db.getScheduleMeta(org_id, manager_id, month);
  const currentDraftCount = meta?.draft_count ?? 0;
  if (currentDraftCount >= MAX_DRAFTS) {
    throw new ValidationError(
      `Maximum of ${MAX_DRAFTS} draft generations per month reached for ${month}`,
    );
  }

  const [shiftsNeeded, employees, existingShifts] = await Promise.all([
    listShiftsNeeded(manager_id, month),
    listEmployeesByManager(org_id, manager_id),
    db.listAllShiftsByManager(manager_id, month),
  ]);

  // Build a tally of already-filled slots so we don't double-assign.
  // Exclude draft_failed sentinels — those slots are still unfilled and should
  // be retried on re-runs (the sentinel is overwritten idempotently by PutItem).
  const filledCounts = new Map<string, number>();
  for (const s of existingShifts) {
    if (s.status === 'draft_failed') continue;
    const key = `${s.date}|${s.location_id}|${s.start_time}|${s.end_time}`;
    filledCounts.set(key, (filledCounts.get(key) ?? 0) + 1);
  }

  const totalUnfilled = shiftsNeeded.reduce((sum, sn) => {
    const key = `${sn.date}|${sn.location_id}|${sn.start_time}|${sn.end_time}`;
    return sum + Math.max(0, sn.employee_count - (filledCounts.get(key) ?? 0));
  }, 0);

  if (shiftsNeeded.length === 0 || totalUnfilled === 0) {
    const newCount = currentDraftCount + 1;
    const now = new Date().toISOString();
    await db.upsertScheduleMeta(org_id, manager_id, month, newCount, now);
    return { created: 0, unfilled: 0, draftFailed: 0, draftCount: newCount, maxDrafts: MAX_DRAFTS };
  }

  if (employees.length === 0) {
    const newCount = currentDraftCount + 1;
    const now = new Date().toISOString();
    await db.upsertScheduleMeta(org_id, manager_id, month, newCount, now);
    return {
      created: 0,
      unfilled: totalUnfilled,
      draftFailed: 0,
      draftCount: newCount,
      maxDrafts: MAX_DRAFTS,
    };
  }

  // Load availability for every employee in parallel
  const monthDates = datesInMonth(month);
  const employeeData: EmployeeData[] = await Promise.all(
    employees.map(async (emp) => {
      const [availRecord, overridesRecord] = await Promise.all([
        db.getEmployeeAvailability(emp.employee_id),
        db.getEmployeeAvailabilityOverrides(emp.employee_id),
      ]);
      const weekly = (availRecord?.['schedule'] as WeeklySchedule) ?? null;
      const overrides = (overridesRecord?.['overrides'] as DateOverrides) ?? null;
      return {
        employee: emp,
        weekly,
        overrides,
        availableDays: countAvailableDays(monthDates, weekly, overrides),
      };
    }),
  );

  // Sort ascending by available days — most constrained first
  employeeData.sort((a, b) => a.availableDays - b.availableDays);

  // Sort shifts by date then start_time
  const sortedShifts = [...shiftsNeeded].sort((a, b) => {
    const dc = a.date.localeCompare(b.date);
    return dc === 0 ? a.start_time.localeCompare(b.start_time) : dc;
  });

  // Track per-day assignment counts this run (in addition to existing shifts)
  const dailyCount = new Map<string, Map<string, number>>();
  const getDaily = (empId: string, date: string) => dailyCount.get(empId)?.get(date) ?? 0;
  const incDaily = (empId: string, date: string) => {
    if (!dailyCount.has(empId)) dailyCount.set(empId, new Map());
    dailyCount.get(empId)!.set(date, getDaily(empId, date) + 1);
  };

  const now = new Date().toISOString();
  let created = 0;
  let unfilled = 0;
  let draftFailed = 0;

  for (const needed of sortedShifts) {
    const slotKey = `${needed.date}|${needed.location_id}|${needed.start_time}|${needed.end_time}`;
    const alreadyFilled = filledCounts.get(slotKey) ?? 0;
    const remaining = Math.max(0, needed.employee_count - alreadyFilled);

    for (let slot = 0; slot < remaining; slot++) {
      const candidate = employeeData.find((ed) => {
        const avail = effectiveAvailability(needed.date, ed.weekly, ed.overrides);
        if (!isAvailableForShift(avail, needed.start_time, needed.end_time)) return false;
        const maxShifts = avail?.max_shifts ?? 1;
        return getDaily(ed.employee.employee_id, needed.date) < maxShifts;
      });

      if (!candidate) {
        // No eligible employee found for this slot.
        // Write a deterministic sentinel record so the manager can see unfillable slots
        // in the UI filtered by "Draft Failed". Using a deterministic SK guarantees
        // idempotency: re-running the generator overwrites (PutItem) the same item
        // rather than accumulating duplicates.
        const failedSuffix = `${manager_id}#${needed.date}#${needed.location_id}#${needed.start_time}#${needed.end_time}`;
        const sentinelShiftId = `FAILED#${failedSuffix}`;
        const sentinel: Shift = {
          PK: `ORG#${org_id}`,
          SK: `SHIFT#FAILED#${failedSuffix}`,
          GSI1PK: `MANAGER#${manager_id}`,
          GSI1SK: needed.date,
          shift_id: sentinelShiftId,
          org_id,
          manager_id,
          employee_id: '',
          employee_name: '',
          location_id: needed.location_id,
          location_name: needed.location_name,
          date: needed.date,
          start_time: needed.start_time,
          end_time: needed.end_time,
          type: inferType(needed.start_time),
          status: 'draft_failed',
          created_at: now,
          updated_at: now,
        };
        await db.createShift(sentinel);
        unfilled++;
        draftFailed++;
        continue;
      }

      incDaily(candidate.employee.employee_id, needed.date);
      filledCounts.set(slotKey, (filledCounts.get(slotKey) ?? 0) + 1);

      const shiftId = randomUUID();
      const shift: Shift = {
        PK: `ORG#${org_id}`,
        SK: `SHIFT#${shiftId}`,
        GSI1PK: `MANAGER#${manager_id}`,
        GSI1SK: needed.date,
        shift_id: shiftId,
        org_id,
        manager_id,
        employee_id: candidate.employee.employee_id,
        employee_name: `${candidate.employee.first_name} ${candidate.employee.last_name}`,
        location_id: needed.location_id,
        location_name: needed.location_name,
        date: needed.date,
        start_time: needed.start_time,
        end_time: needed.end_time,
        type: inferType(needed.start_time),
        status: 'draft',
        created_at: now,
        updated_at: now,
      };

      await db.createShift(shift);
      created++;
    }
  }

  const newDraftCount = currentDraftCount + 1;
  await db.upsertScheduleMeta(org_id, manager_id, month, newDraftCount, now);

  return { created, unfilled, draftFailed, draftCount: newDraftCount, maxDrafts: MAX_DRAFTS };
}

export async function publishSchedule(
  callerSub: string,
  rawMonth: string | undefined,
): Promise<{ published: number }> {
  const month = parseMonth(rawMonth);
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const drafts = await db.listDraftShiftsByManager(manager_id, month);
  if (drafts.length === 0) return { published: 0 };

  const now = new Date().toISOString();
  await Promise.all(drafts.map((s) => db.publishShift(org_id, s.shift_id, now)));

  return { published: drafts.length };
}

export async function getScheduleMetaForCaller(
  callerSub: string,
  rawMonth: string | undefined,
): Promise<{ draftCount: number; maxDrafts: number }> {
  const month = parseMonth(rawMonth);
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);
  const meta = await db.getScheduleMeta(org_id, manager_id, month);
  return { draftCount: meta?.draft_count ?? 0, maxDrafts: MAX_DRAFTS };
}

export async function getDraftSummary(
  callerSub: string,
  rawMonth: string | undefined,
): Promise<ManagerScheduleDraftsResponse> {
  const month = parseMonth(rawMonth);
  const { manager_id } = await resolveCallerOrg(callerSub);
  const drafts = await db.listDraftShiftsByManager(manager_id, month);
  return { drafts: drafts.map((s) => stripKeys(s)) };
}
