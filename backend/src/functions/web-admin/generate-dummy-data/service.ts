/**
 * Business logic for the generate-dummy-data feature.
 *
 * Discovers all orgs, their employees, managers, and locations from DynamoDB,
 * then generates realistic availability and open shift records for the
 * requested month. All data generation uses Math.random() — no seeding —
 * except the zero-availability rule which is deterministic (first employee
 * alphabetically by email always gets no availability record written).
 */
import { randomUUID } from 'node:crypto';
import type { GenerateDummyDataBody } from '@daltime/contracts';
import { ValidationError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { listOrgLocations } from '../../shared/dynamo.js';
import { listOrganizations } from '../organizations/db.js';
import { listEmployeesByOrg } from '../../org-admin/employees/db.js';
import { listManagersByOrg } from '../../org-admin/managers/db.js';
import { batchWriteAvailability, batchWriteShifts } from './db.js';
import type { OrgBundle, ShiftPreset } from './model.js';
import type {
  EmployeeAvailability,
  WeeklySchedule,
  DayAvailability,
  DayOfWeek,
} from '../../shared/models/employee/availability.model.js';
import type { Shift, ShiftType } from '../../shared/models/manager/shift.model.js';
import type { Organization } from '../../shared/models/web-admin/organization.model.js';

/** All days of the week in order. */
const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Fixed realistic shift presets for open shift generation. Using a known
 * set prevents generating nonsensical durations (e.g. 3-minute shifts) and
 * keeps the dummy data useful for testing realistic scheduling scenarios.
 */
const SHIFT_PRESETS: ShiftPreset[] = [
  { start_time: '08:00', end_time: '16:00', type: 'morning' },
  { start_time: '09:00', end_time: '17:00', type: 'morning' },
  { start_time: '10:00', end_time: '18:00', type: 'morning' },
  { start_time: '12:00', end_time: '20:00', type: 'afternoon' },
  { start_time: '13:00', end_time: '21:00', type: 'afternoon' },
  { start_time: '14:00', end_time: '22:00', type: 'afternoon' },
  { start_time: '16:00', end_time: '00:00', type: 'night' },
  { start_time: '22:00', end_time: '06:00', type: 'night' },
];

/**
 * Return the current server-side year and month (1-indexed).
 * Extracted as its own function so tests can spy on it and control the
 * "current" date without needing to mock the global Date constructor.
 */
export function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Validate the request body for generate-dummy-data.
 * Returns a typed body if valid; throws ValidationError with a specific
 * field-level message otherwise so the caller can surface it as a 400.
 *
 * The allowed date window is [current month/year, current month/year + 24 months]
 * inclusive. Requests before the current month are rejected to prevent generating
 * stale data, and requests beyond 24 months are rejected because the frontend
 * picker does not expose dates further out than that.
 */
export function validateBody(raw: unknown): GenerateDummyDataBody {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const body = raw as Record<string, unknown>;

  if (body['year'] === undefined || body['year'] === null) {
    throw new ValidationError('year is required');
  }
  if (typeof body['year'] !== 'number' || !Number.isInteger(body['year'])) {
    throw new ValidationError('year must be an integer');
  }
  const year = body['year'] as number;

  if (body['month'] === undefined || body['month'] === null) {
    throw new ValidationError('month is required');
  }
  if (typeof body['month'] !== 'number' || !Number.isInteger(body['month'])) {
    throw new ValidationError('month must be an integer');
  }
  const month = body['month'] as number;
  if (month < 1 || month > 12) {
    throw new ValidationError('month must be between 1 and 12 (1-indexed)');
  }

  // Compute the allowed window using the server-side clock.
  // Convert both the request and the boundaries to a single integer (year*12+month)
  // for easy numeric comparison — this avoids any date arithmetic edge cases with
  // month wrap-around.
  const { year: currentYear, month: currentMonth } = getCurrentYearMonth();
  const requestIndex = year * 12 + month;
  const currentIndex = currentYear * 12 + currentMonth;
  const maxIndex = currentIndex + 24;

  if (requestIndex < currentIndex) {
    throw new ValidationError('month/year must not be in the past');
  }
  if (requestIndex > maxIndex) {
    throw new ValidationError('month/year must be within 24 months from now');
  }

  return { year, month };
}

/**
 * Return the number of days in a given month/year, correctly handling
 * leap years. Uses the Date trick: day 0 of next month = last day of current month.
 */
export function daysInMonth(year: number, month: number): number {
  // month is 1-indexed here; Date month is 0-indexed, so passing month (not month-1)
  // as the 0-indexed month gives us the first day of the NEXT month — day 0
  // of that is the last day of the original month.
  return new Date(year, month, 0).getDate();
}

/**
 * Format a date as a YYYY-MM-DD string without timezone drift.
 * Uses explicit component formatting rather than toISOString() to avoid UTC
 * offset shifting the day (e.g. 2026-01-01T00:00 in US/Eastern would show
 * as 2025-12-31 if serialized via toISOString).
 */
export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Pick a random integer in [min, max] inclusive.
 * Used for shift count per org and day-of-month selection.
 */
export function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 * Throws if the array is empty, since callers should guard against that
 * before calling (an empty array indicates a data problem, not an expected case).
 */
export function randomElement<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('Cannot pick from an empty array');
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a random WeeklySchedule for one employee.
 *
 * Each day independently has a 70% chance of being available. If available,
 * a single time slot is assigned using one of the SHIFT_PRESETS as the
 * time window, and max_shifts is set to 1. This produces realistic-looking
 * availability without over-constraining the scheduling algorithm tests.
 */
export function generateRandomWeeklySchedule(): WeeklySchedule {
  const schedule = {} as WeeklySchedule;

  for (const day of DAYS_OF_WEEK) {
    const isAvailable = Math.random() < 0.7;
    if (!isAvailable) {
      const dayAvailability: DayAvailability = { available: false };
      schedule[day] = dayAvailability;
      continue;
    }

    // Pick one of the morning/afternoon/night preset windows for the slot.
    const preset = randomElement(SHIFT_PRESETS);
    const dayAvailability: DayAvailability = {
      available: true,
      slots: [{ from: preset.start_time, to: preset.end_time }],
      max_shifts: 1,
    };
    schedule[day] = dayAvailability;
  }

  return schedule;
}

/**
 * Build EmployeeAvailability DynamoDB items for all employees in an org,
 * skipping the zero-availability employee (the first alphabetically by email).
 *
 * The zero-availability rule is deterministic: we sort employee emails ascending
 * and skip index 0 entirely — no availability record is written for that employee.
 * This simulates the realistic scenario of an employee who submitted no availability
 * for the week, which the scheduling algorithm must handle gracefully.
 */
export function buildAvailabilityRecords(bundle: OrgBundle): EmployeeAvailability[] {
  const now = new Date().toISOString();
  const records: EmployeeAvailability[] = [];

  // Sort emails ascending for the deterministic zero-availability rule.
  const sortedEmails = [...bundle.employee_emails_sorted];

  for (let i = 0; i < sortedEmails.length; i++) {
    // Index 0 (first alphabetically) is always skipped — zero-availability rule.
    if (i === 0) continue;

    const email = sortedEmails[i];
    const employeeId = bundle.employee_email_to_id[email];
    if (!employeeId) continue; // defensive: skip if lookup is somehow missing

    const schedule = generateRandomWeeklySchedule();
    const record: EmployeeAvailability = {
      PK: `USER#${employeeId}`,
      SK: 'AVAILABILITY',
      employee_id: employeeId,
      org_id: bundle.org_id,
      schedule,
      updated_at: now,
    };
    records.push(record);
  }

  return records;
}

/**
 * Build open Shift DynamoDB items for one org.
 *
 * Generates a random count of shifts (5–15) spread randomly across days
 * in the month. Each shift picks a random SHIFT_PRESET for its time window
 * and a random location from the org's locations. The shift is unassigned
 * (employee_id and employee_name are empty strings) and published.
 *
 * The manager_id is required for GSI1PK — it must be a real manager from
 * the org. If no locations exist, no shifts are generated for that org.
 */
export function buildOpenShifts(bundle: OrgBundle, year: number, month: number): Shift[] {
  // Cannot generate open shifts without at least one location or a manager.
  if (bundle.locations.length === 0 || !bundle.manager_id) return [];

  const totalDays = daysInMonth(year, month);
  const shiftCount = randomIntInclusive(5, 15);
  const now = new Date().toISOString();
  const shifts: Shift[] = [];

  for (let i = 0; i < shiftCount; i++) {
    const day = randomIntInclusive(1, totalDays);
    const date = formatDate(year, month, day);
    const preset = randomElement(SHIFT_PRESETS);
    const location = randomElement(bundle.locations);
    const shiftId = randomUUID();

    const shift: Shift = {
      PK: `ORG#${bundle.org_id}`,
      SK: `SHIFT#${shiftId}`,
      GSI1PK: `MANAGER#${bundle.manager_id}`,
      // GSI1SK uses date+start_time for the manager's by-month schedule query.
      GSI1SK: `${date}T${preset.start_time}`,
      shift_id: shiftId,
      org_id: bundle.org_id,
      manager_id: bundle.manager_id,
      employee_id: '',
      employee_name: '',
      location_id: location.location_id,
      location_name: location.location_name,
      date,
      start_time: preset.start_time,
      end_time: preset.end_time,
      type: preset.type as ShiftType,
      status: 'published',
      created_at: now,
      updated_at: now,
    };
    shifts.push(shift);
  }

  return shifts;
}

/**
 * Discover all the data needed for one org before generating dummy records.
 *
 * Queries employees, managers, and locations in parallel to minimise latency.
 * Returns null if the org has no employees or no managers — skipping orgs
 * with incomplete setup prevents writing shift records with blank GSI1PK.
 */
async function discoverOrgBundle(org_id: string): Promise<OrgBundle | null> {
  const [employees, managers, locations] = await Promise.all([
    listEmployeesByOrg(org_id),
    listManagersByOrg(org_id),
    listOrgLocations(org_id),
  ]);

  // Skip orgs with no employees — nothing to generate availability for.
  if (employees.length === 0) return null;

  // Resolve manager_id: require at least one manager so GSI1PK is never blank.
  if (managers.length === 0) return null;
  const manager_id = managers[0].manager_id;

  // Build email→id lookup and sort emails for the zero-availability rule.
  const email_to_id: Record<string, string> = {};
  for (const emp of employees) {
    email_to_id[emp.email] = emp.employee_id;
  }
  const sorted_emails = Object.keys(email_to_id).sort();

  return {
    org_id,
    employee_emails_sorted: sorted_emails,
    employee_email_to_id: email_to_id,
    manager_id,
    locations: locations.map((loc) => ({
      location_id: loc.location_id,
      location_name: loc.name,
    })),
  };
}

/**
 * The org_id of the seeded Sunset Cafe dummy organization.
 * Dummy data generation is intentionally scoped to this org only —
 * real customer orgs (e.g. YMCA) must never receive generated test data.
 */
const SEED_ORG_ID = 'seed-org-sunsetcafe-001';

/**
 * Main entry point for dummy data generation.
 *
 * Validates the request body, then generates availability records and open
 * shifts for the Sunset Cafe seed org only. Scoped by SEED_ORG_ID so real
 * customer orgs are never touched.
 *
 * Returns a summary message describing what was generated.
 */
export async function generateDummyData(rawBody: unknown): Promise<string> {
  const { year, month } = validateBody(rawBody);

  // Scope to seed org only — never generate dummy data for real customer orgs.
  const allOrgs = (await listOrganizations()) as Array<Organization & Record<string, unknown>>;
  const orgs = allOrgs.filter((o) => o.org_id === SEED_ORG_ID);
  if (orgs.length === 0) {
    return 'Seed org not found — nothing generated';
  }

  let totalAvailabilityRecords = 0;
  let totalShifts = 0;
  let orgsProcessed = 0;

  // Process each org independently — failures in one org do not block others.
  for (const org of orgs) {
    const orgId = org.org_id;
    if (!orgId) continue;

    const bundle = await discoverOrgBundle(orgId);
    if (!bundle) {
      // Org has no employees or no managers — skip it silently.
      continue;
    }

    // Build and write availability records (skipping the zero-availability employee).
    const availabilityRecords = buildAvailabilityRecords(bundle);
    await batchWriteAvailability(availabilityRecords);

    // Build and write open shifts spread across the month.
    const openShifts = buildOpenShifts(bundle, year, month);
    await batchWriteShifts(openShifts);

    totalAvailabilityRecords += availabilityRecords.length;
    totalShifts += openShifts.length;
    orgsProcessed++;
  }

  logger.info('dummy data generated', { year, month, orgs_processed: orgsProcessed, availability_records: totalAvailabilityRecords, shifts: totalShifts });
  return (
    `Generated dummy data for ${month}/${year}: ` +
    `${totalAvailabilityRecords} availability records and ` +
    `${totalShifts} open shifts across ${orgsProcessed} org(s)`
  );
}
