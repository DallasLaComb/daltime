import { stripKeys } from '../../shared/dynamo.js';
import type {
  DayOfWeek,
  DayAvailability,
  TimeSlot,
  WeeklySchedule,
  UpsertAvailabilityBody,
} from '@daltime/contracts';
import * as db from './db.js';

import { ValidationError, ForbiddenError } from '../../shared/errors.js';

const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function resolveCallerOrg(sub: string): Promise<{ org_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

function validateSlots(slots: unknown, dayKey: string): TimeSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ValidationError(
      `schedule.${dayKey}.slots must be a non-empty array when available is true`,
    );
  }
  return slots.map((slot, i) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      throw new ValidationError(`schedule.${dayKey}.slots[${i}] must be an object`);
    }
    const { from, to } = slot as Record<string, unknown>;
    if (typeof from !== 'string' || !TIME_RE.test(from)) {
      throw new ValidationError(`schedule.${dayKey}.slots[${i}].from must be a valid HH:MM time`);
    }
    if (typeof to !== 'string' || !TIME_RE.test(to)) {
      throw new ValidationError(`schedule.${dayKey}.slots[${i}].to must be a valid HH:MM time`);
    }
    if (from >= to) {
      throw new ValidationError(`schedule.${dayKey}.slots[${i}].from must be before to`);
    }
    return { from, to };
  });
}

function validateDayEntry(
  available: unknown,
  slots: unknown,
  max_shifts: unknown,
  dayKey: string,
): DayAvailability {
  if (typeof available !== 'boolean') {
    throw new ValidationError(`schedule.${dayKey}.available must be a boolean`);
  }
  if (!available) return { available: false };
  const validSlots = validateSlots(slots, dayKey);
  const shiftsNum = typeof max_shifts === 'number' ? max_shifts : Number(max_shifts);
  if (!Number.isInteger(shiftsNum) || shiftsNum < 1 || shiftsNum > validSlots.length) {
    throw new ValidationError(
      `schedule.${dayKey}.max_shifts must be an integer between 1 and ${validSlots.length}`,
    );
  }
  return { available: true, slots: validSlots, max_shifts: shiftsNum };
}

function validateSchedule(schedule: unknown): WeeklySchedule {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new ValidationError('schedule must be an object');
  }

  const validated: Partial<WeeklySchedule> = {};

  for (const day of DAYS_OF_WEEK) {
    const entry = (schedule as Record<string, unknown>)[day];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(`schedule.${day} must be an object`);
    }
    const { available, slots, max_shifts } = entry as Record<string, unknown>;
    validated[day] = validateDayEntry(available, slots, max_shifts, day);
  }

  return validated as WeeklySchedule;
}

/** Migrates legacy { from, to } shape to the current { slots, max_shifts } shape. */
function migrateDay(raw: Record<string, unknown>): DayAvailability {
  if (!raw.available) return { available: false };
  // Legacy format written before the slots migration
  if (typeof raw['from'] === 'string' && typeof raw['to'] === 'string' && !raw['slots']) {
    return {
      available: true,
      slots: [{ from: raw['from'], to: raw['to'] }],
      max_shifts: 1,
    };
  }
  return raw as unknown as DayAvailability;
}

function migrateSchedule(schedule: WeeklySchedule): WeeklySchedule {
  const migrated: Partial<WeeklySchedule> = {};
  for (const day of DAYS_OF_WEEK) {
    migrated[day] = migrateDay(schedule[day] as unknown as Record<string, unknown>);
  }
  return migrated as WeeklySchedule;
}

export async function getAvailability(callerSub: string) {
  await resolveCallerOrg(callerSub);
  const record = await db.getAvailability(callerSub);
  if (!record) return null;
  const stripped = stripKeys(record) as { schedule?: WeeklySchedule; updated_at?: string };
  if (stripped.schedule) {
    stripped.schedule = migrateSchedule(stripped.schedule);
  }
  return stripped;
}

export async function upsertAvailability(callerSub: string, body: UpsertAvailabilityBody) {
  if (!body.schedule) throw new ValidationError('schedule is required');

  const schedule = validateSchedule(body.schedule);
  const { org_id } = await resolveCallerOrg(callerSub);

  const record = {
    PK: `USER#${callerSub}`,
    SK: 'AVAILABILITY',
    employee_id: callerSub,
    org_id,
    schedule,
    updated_at: new Date().toISOString(),
  };

  await db.upsertAvailability(record);
  return stripKeys(record);
}
