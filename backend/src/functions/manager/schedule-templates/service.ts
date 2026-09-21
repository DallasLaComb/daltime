import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import { getOrgLocation } from '../../shared/dynamo.js';
import * as db from './db.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import type {
  ScheduleTemplateRecord,
  TemplateShiftBlock,
  DayKey,
  ShiftNeededRecord,
} from '@daltime/contracts';

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; manager_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

function validateShiftBlocks(blocks: TemplateShiftBlock[]): void {
  if (blocks.length === 0) throw new ValidationError('shift_blocks must not be empty');
  if (blocks.length > 20) throw new ValidationError('shift_blocks may not exceed 20 items');
  const validDays = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  for (const block of blocks) {
    if (!block.days || block.days.length === 0) {
      throw new ValidationError('Each shift block must specify at least one day');
    }
    for (const d of block.days) {
      if (!validDays.has(d)) throw new ValidationError(`Invalid day key: ${d}`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(block.start_time)) {
      throw new ValidationError('start_time must be in HH:MM format');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(block.end_time)) {
      throw new ValidationError('end_time must be in HH:MM format');
    }
    if (block.end_time <= block.start_time) {
      throw new ValidationError('end_time must be after start_time in each block');
    }
    const count = Number(block.employee_count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new ValidationError('employee_count must be an integer between 1 and 50');
    }
  }
}

export async function listTemplates(callerSub: string) {
  const { manager_id } = await resolveCallerOrg(callerSub);
  const templates = await db.listTemplates(manager_id);
  return templates.map((t) => stripKeys(t));
}

export async function createTemplate(
  callerSub: string,
  body: { location_id?: string; name?: string; shift_blocks?: TemplateShiftBlock[] },
) {
  if (!body.location_id) throw new ValidationError('location_id is required');
  if (!body.name || body.name.trim().length === 0) throw new ValidationError('name is required');
  if (body.name.trim().length > 80) throw new ValidationError('name must be 80 characters or fewer');
  if (!body.shift_blocks) throw new ValidationError('shift_blocks is required');
  validateShiftBlocks(body.shift_blocks);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const location = await getOrgLocation(org_id, body.location_id);
  if (!location) throw new ForbiddenError('Location not found in your organization');

  const templateId = randomUUID();
  const now = new Date().toISOString();

  const item: ScheduleTemplateRecord = {
    PK: `ORG#${org_id}`,
    SK: `SCHEDULE_TEMPLATE#${templateId}`,
    GSI1PK: `MANAGER#${manager_id}`,
    GSI1SK: `TEMPLATE#${templateId}`,
    template_id: templateId,
    org_id,
    manager_id,
    location_id: body.location_id,
    location_name: location.name,
    name: body.name.trim(),
    shift_blocks: body.shift_blocks,
    created_at: now,
    updated_at: now,
  };

  await db.createTemplate(item);
  return stripKeys(item);
}

export async function updateTemplate(
  callerSub: string,
  templateId: string,
  body: { name?: string; shift_blocks?: TemplateShiftBlock[] },
) {
  if (Object.keys(body).length === 0) {
    throw new ValidationError('At least one field must be provided');
  }
  if (body.name !== undefined) {
    if (body.name.trim().length === 0) throw new ValidationError('name must not be empty');
    if (body.name.trim().length > 80) throw new ValidationError('name must be 80 characters or fewer');
  }
  if (body.shift_blocks !== undefined) {
    validateShiftBlocks(body.shift_blocks);
  }

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const existing = await db.getTemplate(org_id, templateId);
  if (!existing) throw new NotFoundError('Template not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this template');

  const fields: { name?: string; shift_blocks?: TemplateShiftBlock[] } = {};
  if (body.name !== undefined) fields.name = body.name.trim();
  if (body.shift_blocks !== undefined) fields.shift_blocks = body.shift_blocks;

  const updated = await db.updateTemplate(org_id, templateId, fields, new Date().toISOString());
  if (!updated) throw new NotFoundError('Template not found');
  return stripKeys(updated);
}

export async function removeTemplate(callerSub: string, templateId: string) {
  const { org_id, manager_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getTemplate(org_id, templateId);
  if (!existing) throw new NotFoundError('Template not found');
  if (existing.manager_id !== manager_id) throw new ForbiddenError('You do not own this template');
  await db.deleteTemplate(org_id, templateId);
}

export async function applyTemplate(
  callerSub: string,
  templateId: string,
  body: { start_date?: string; end_date?: string; skip_dates?: string[] },
) {
  if (!body.start_date) throw new ValidationError('start_date is required');
  if (!body.end_date) throw new ValidationError('end_date is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
    throw new ValidationError('start_date must be in YYYY-MM-DD format');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
    throw new ValidationError('end_date must be in YYYY-MM-DD format');
  }
  if (body.end_date < body.start_date) {
    throw new ValidationError('end_date must be on or after start_date');
  }

  const startMs = new Date(body.start_date).getTime();
  const endMs = new Date(body.end_date).getTime();
  const dayMs = 86_400_000;
  if (endMs - startMs > 366 * dayMs) {
    throw new ValidationError('Date range may not exceed 366 days');
  }

  const skipSet = new Set(body.skip_dates ?? []);

  const { org_id, manager_id } = await resolveCallerOrg(callerSub);

  const template = await db.getTemplate(org_id, templateId);
  if (!template) throw new NotFoundError('Template not found');
  if (template.manager_id !== manager_id) throw new ForbiddenError('You do not own this template');

  const now = new Date().toISOString();
  const created: ReturnType<typeof stripKeys<ShiftNeededRecord>>[] = [];

  let cursor = new Date(body.start_date + 'T12:00:00Z');
  const end = new Date(body.end_date + 'T12:00:00Z');

  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);

    if (!skipSet.has(dateStr)) {
      const dayKey = DAY_KEYS[cursor.getUTCDay()];
      const matchingBlocks = template.shift_blocks.filter((b) => b.days.includes(dayKey));

      for (const block of matchingBlocks) {
        const shiftId = randomUUID();
        const item: ShiftNeededRecord = {
          PK: `ORG#${org_id}`,
          SK: `SHIFT_NEEDED#${shiftId}`,
          GSI1PK: `MANAGER#${manager_id}`,
          GSI1SK: dateStr,
          shift_id: shiftId,
          org_id,
          manager_id,
          date: dateStr,
          start_time: block.start_time,
          end_time: block.end_time,
          employee_count: block.employee_count,
          location_id: template.location_id,
          location_name: template.location_name,
          created_at: now,
          updated_at: now,
        };
        await db.createShiftNeeded(item);
        created.push(stripKeys(item));
      }
    }

    cursor = new Date(cursor.getTime() + dayMs);
  }

  return { created: created.length, shifts: created };
}
