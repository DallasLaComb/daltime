import { stripKeys } from '../../shared/dynamo.js';
import type {
  DayAvailability,
  TimeSlot,
  DateOverrides,
  UpsertOverridesBody,
} from '@daltime/contracts';
import * as db from './db.js';

import { ValidationError, ForbiddenError } from '../../shared/errors.js';

const ISO_DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function resolveCallerOrg(sub: string): Promise<{ org_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

function validateSlots(slots: unknown, dateKey: string): TimeSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ValidationError(
      `overrides.${dateKey}.slots must be a non-empty array when available is true`,
    );
  }
  return slots.map((slot, i) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      throw new ValidationError(`overrides.${dateKey}.slots[${i}] must be an object`);
    }
    const { from, to } = slot as Record<string, unknown>;
    if (typeof from !== 'string' || !TIME_RE.test(from)) {
      throw new ValidationError(`overrides.${dateKey}.slots[${i}].from must be a valid HH:MM time`);
    }
    if (typeof to !== 'string' || !TIME_RE.test(to)) {
      throw new ValidationError(`overrides.${dateKey}.slots[${i}].to must be a valid HH:MM time`);
    }
    if (from >= to) {
      throw new ValidationError(`overrides.${dateKey}.slots[${i}].from must be before to`);
    }
    return { from, to };
  });
}

function validateOverrideEntry(date: string, entry: unknown): DayAvailability {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ValidationError(`overrides.${date} must be an object`);
  }
  const { available, slots, max_shifts } = entry as Record<string, unknown>;
  if (typeof available !== 'boolean') {
    throw new ValidationError(`overrides.${date}.available must be a boolean`);
  }
  if (!available) return { available: false };
  const validSlots = validateSlots(slots, date);
  const shiftsNum = typeof max_shifts === 'number' ? max_shifts : Number(max_shifts);
  if (!Number.isInteger(shiftsNum) || shiftsNum < 1 || shiftsNum > validSlots.length) {
    throw new ValidationError(
      `overrides.${date}.max_shifts must be an integer between 1 and ${validSlots.length}`,
    );
  }
  return { available: true, slots: validSlots, max_shifts: shiftsNum };
}

function validateOverrides(raw: unknown): DateOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('overrides must be an object');
  }

  const validated: DateOverrides = {};

  for (const [date, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!ISO_DATE_RE.test(date)) {
      throw new ValidationError(`Override key "${date}" must be a valid ISO date (YYYY-MM-DD)`);
    }
    validated[date] = validateOverrideEntry(date, entry);
  }

  return validated;
}

/** Migrates legacy { from, to } shape to the current { slots, max_shifts } shape. */
function migrateDay(raw: Record<string, unknown>): DayAvailability {
  if (!raw.available) return { available: false };
  if (typeof raw['from'] === 'string' && typeof raw['to'] === 'string' && !raw['slots']) {
    return {
      available: true,
      slots: [{ from: raw['from'], to: raw['to'] }],
      max_shifts: 1,
    };
  }
  return raw as unknown as DayAvailability;
}

export async function getAvailabilityOverrides(callerSub: string) {
  await resolveCallerOrg(callerSub);
  const record = await db.getAvailabilityOverrides(callerSub);
  if (!record) return null;
  const stripped = stripKeys(record) as { overrides?: DateOverrides; updated_at?: string };
  if (stripped.overrides) {
    const migrated: DateOverrides = {};
    for (const [date, day] of Object.entries(stripped.overrides)) {
      migrated[date] = migrateDay(day as unknown as Record<string, unknown>);
    }
    stripped.overrides = migrated;
  }
  return stripped;
}

export async function upsertAvailabilityOverrides(callerSub: string, body: UpsertOverridesBody) {
  if (!body.overrides) throw new ValidationError('overrides is required');

  const overrides = validateOverrides(body.overrides);
  const { org_id } = await resolveCallerOrg(callerSub);

  const record = {
    PK: `USER#${callerSub}`,
    SK: 'AVAILABILITY_OVERRIDES',
    employee_id: callerSub,
    org_id,
    overrides,
    updated_at: new Date().toISOString(),
  };

  await db.upsertAvailabilityOverrides(record);
  return stripKeys(record);
}
