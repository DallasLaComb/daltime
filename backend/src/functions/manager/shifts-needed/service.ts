import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import { getLocation } from '../locations/db.js';
import * as db from './db.js';

import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; manager_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

function parseMonth(raw: string | undefined): string {
  const month = raw ?? nextMonthString();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError('month must be in YYYY-MM format');
  return month;
}

function nextMonthString(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError('date must be in YYYY-MM-DD format');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) throw new ValidationError('date must not be in the past');
}

function validateTime(time: string, field: string): void {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new ValidationError(`${field} must be in HH:MM format`);
  }
}

function validateNotes(notes: string | undefined): void {
  if (notes !== undefined && notes.trim().length > 500) {
    throw new ValidationError('notes must be 500 characters or fewer');
  }
}

export async function listShifts(callerSub: string, rawMonth: string | undefined) {
  const month = parseMonth(rawMonth);
  const { manager_id } = await resolveCallerOrg(callerSub);
  const shifts = await db.listShifts(manager_id, month);
  return shifts
    .map((s) => stripKeys(s))
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      return dateCompare === 0 ? a.start_time.localeCompare(b.start_time) : dateCompare;
    });
}

export async function createShift(
  callerSub: string,
  body: {
    date?: string;
    start_time?: string;
    end_time?: string;
    employee_count?: number;
    location_id?: string;
    notes?: string;
  },
) {
  if (!body.date) throw new ValidationError('date is required');
  if (!body.start_time) throw new ValidationError('start_time is required');
  if (!body.end_time) throw new ValidationError('end_time is required');
  if (body.employee_count === undefined) throw new ValidationError('employee_count is required');
  if (!body.location_id) throw new ValidationError('location_id is required');

  validateDate(body.date);
  validateTime(body.start_time, 'start_time');
  validateTime(body.end_time, 'end_time');
  if (body.end_time <= body.start_time) {
    throw new ValidationError('end_time must be after start_time');
  }

  const count = Number(body.employee_count);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new ValidationError('employee_count must be an integer between 1 and 50');
  }

  validateNotes(body.notes);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const location = await getLocation(org_id, body.location_id);
  if (!location) throw new ForbiddenError('Location not found in your organization');

  const shiftId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${org_id}`,
    SK: `SHIFT_NEEDED#${shiftId}`,
    GSI1PK: `MANAGER#${manager_id}`,
    GSI1SK: body.date,
    shift_id: shiftId,
    org_id,
    manager_id,
    date: body.date,
    start_time: body.start_time,
    end_time: body.end_time,
    employee_count: count,
    location_id: body.location_id,
    location_name: location.name,
    ...(body.notes?.trim() ? { notes: body.notes.trim() } : {}),
    created_at: now,
    updated_at: now,
  };

  await db.createShift(item);
  logger.info('shift needed created', { org_id, shift_id: shiftId, manager_id });
  return stripKeys(item);
}

type ShiftNeededUpdateBody = {
  date?: string;
  start_time?: string;
  end_time?: string;
  employee_count?: number;
  location_id?: string;
  notes?: string;
};

function validateShiftNeededUpdateBody(body: ShiftNeededUpdateBody): void {
  if (Object.keys(body).length === 0)
    throw new ValidationError('At least one field must be provided');
  if (body.date !== undefined) validateDate(body.date);
  if (body.start_time !== undefined) validateTime(body.start_time, 'start_time');
  if (body.end_time !== undefined) validateTime(body.end_time, 'end_time');
  if (
    body.start_time !== undefined &&
    body.end_time !== undefined &&
    body.end_time <= body.start_time
  ) {
    throw new ValidationError('end_time must be after start_time');
  }
  if (body.employee_count !== undefined) {
    const count = Number(body.employee_count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new ValidationError('employee_count must be an integer between 1 and 50');
    }
  }
  validateNotes(body.notes);
}

export async function updateShift(callerSub: string, shiftId: string, body: ShiftNeededUpdateBody) {
  validateShiftNeededUpdateBody(body);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const existing = await db.getShift(org_id, shiftId);
  if (!existing) throw new NotFoundError('Shift not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this shift');

  let locationName: string | undefined;
  if (body.location_id) {
    const location = await getLocation(org_id, body.location_id);
    if (!location) throw new ForbiddenError('Location not found in your organization');
    locationName = location.name;
  }

  const updatedAt = new Date().toISOString();
  const fields: Parameters<typeof db.updateShift>[2] = {};
  if (body.date !== undefined) fields.date = body.date;
  if (body.start_time !== undefined) fields.start_time = body.start_time;
  if (body.end_time !== undefined) fields.end_time = body.end_time;
  if (body.employee_count !== undefined) fields.employee_count = Number(body.employee_count);
  if (body.location_id !== undefined) fields.location_id = body.location_id;
  if (locationName !== undefined) fields.location_name = locationName;
  if (body.notes !== undefined) fields.notes = body.notes.trim() || null;

  const updated = await db.updateShift(org_id, shiftId, fields, updatedAt);
  if (!updated) throw new NotFoundError('Shift not found');
  logger.info('shift needed updated', { org_id, shift_id: shiftId });
  return stripKeys(updated);
}

export async function removeShift(callerSub: string, shiftId: string) {
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getShift(org_id, shiftId);
  if (!existing) throw new NotFoundError('Shift not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this shift');
  await db.deleteShift(org_id, shiftId);
  logger.info('shift needed removed', { org_id, shift_id: shiftId });
}
