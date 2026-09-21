import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';
import type { ShiftType } from '../../shared/models/manager/shift.model.js';

import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

const VALID_TYPES: ShiftType[] = ['morning', 'afternoon', 'night'];

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; manager_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

function parseMonth(raw: string | undefined): string {
  const month = raw ?? currentMonthString();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError('month must be in YYYY-MM format');
  return month;
}

function currentMonthString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError('date must be in YYYY-MM-DD format');
  }
}

function validateTime(time: string, field: string): void {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new ValidationError(`${field} must be in HH:MM format`);
  }
}

function validateType(type: string): asserts type is ShiftType {
  if (!VALID_TYPES.includes(type as ShiftType)) {
    throw new ValidationError(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }
}

export async function listShifts(callerSub: string, rawMonth: string | undefined) {
  const month = parseMonth(rawMonth);
  const { manager_id } = await resolveCallerOrg(callerSub);
  const shifts = await db.listShiftsByManager(manager_id, month);
  return shifts
    .map((s) => stripKeys(s))
    .sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      return dc === 0 ? a.start_time.localeCompare(b.start_time) : dc;
    });
}

export async function createShift(
  callerSub: string,
  body: {
    employee_id?: string;
    location_id?: string;
    date?: string;
    start_time?: string;
    end_time?: string;
    type?: string;
  },
) {
  if (!body.employee_id) throw new ValidationError('employee_id is required');
  if (!body.location_id) throw new ValidationError('location_id is required');
  if (!body.date) throw new ValidationError('date is required');
  if (!body.start_time) throw new ValidationError('start_time is required');
  if (!body.end_time) throw new ValidationError('end_time is required');
  if (!body.type) throw new ValidationError('type is required');

  validateDate(body.date);
  validateTime(body.start_time, 'start_time');
  validateTime(body.end_time, 'end_time');
  if (body.end_time <= body.start_time) {
    throw new ValidationError('end_time must be after start_time');
  }
  validateType(body.type);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const employee = await db.getEmployee(org_id, body.employee_id);
  if (employee?.manager_id !== manager_id) {
    throw new ForbiddenError('Employee not found in your team');
  }

  const shiftId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${org_id}`,
    SK: `SHIFT#${shiftId}`,
    GSI1PK: `MANAGER#${manager_id}`,
    GSI1SK: body.date,
    shift_id: shiftId,
    org_id,
    manager_id,
    employee_id: body.employee_id,
    employee_name: `${employee.first_name} ${employee.last_name}`,
    location_id: body.location_id,
    location_name: '',
    date: body.date,
    start_time: body.start_time,
    end_time: body.end_time,
    type: body.type,
    status: 'published' as const,
    created_at: now,
    updated_at: now,
  };

  await db.createShift(item);
  logger.info('shift created', { org_id, shift_id: shiftId, manager_id });
  return stripKeys(item);
}

type ShiftUpdateBody = {
  employee_id?: string;
  location_id?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  type?: string;
};

function validateShiftUpdateBody(body: ShiftUpdateBody): void {
  if (Object.keys(body).length === 0) throw new ValidationError('At least one field is required');
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
  if (body.type !== undefined) validateType(body.type);
}

export async function updateShift(callerSub: string, shiftId: string, body: ShiftUpdateBody) {
  validateShiftUpdateBody(body);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const existing = await db.getShift(org_id, shiftId);
  if (!existing) throw new NotFoundError('Shift not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this shift');

  const fields: Parameters<typeof db.updateShift>[2] = {};
  if (body.date !== undefined) fields.date = body.date;
  if (body.start_time !== undefined) fields.start_time = body.start_time;
  if (body.end_time !== undefined) fields.end_time = body.end_time;
  if (body.type !== undefined) fields.type = body.type;

  if (body.employee_id !== undefined) {
    const employee = await db.getEmployee(org_id, body.employee_id);
    if (employee?.manager_id !== manager_id) {
      throw new ForbiddenError('Employee not found in your team');
    }
    fields.employee_id = body.employee_id;
    fields.employee_name = `${employee.first_name} ${employee.last_name}`;
  }

  if (body.location_id !== undefined) {
    fields.location_id = body.location_id;
  }

  const updated = await db.updateShift(org_id, shiftId, fields, new Date().toISOString());
  if (!updated) throw new NotFoundError('Shift not found');
  logger.info('shift updated', { org_id, shift_id: shiftId });
  return stripKeys(updated);
}

export async function removeShift(callerSub: string, shiftId: string) {
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getShift(org_id, shiftId);
  if (!existing) throw new NotFoundError('Shift not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this shift');
  await db.deleteShift(org_id, shiftId);
  logger.info('shift removed', { org_id, shift_id: shiftId });
}
