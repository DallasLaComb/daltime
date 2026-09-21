import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; user_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function listLocations(callerSub: string, managerId: string) {
  const { org_id } = await resolveCallerOrg(callerSub);

  // Verify the manager belongs to this org
  const manager = await db.getManager(org_id, managerId);
  if (!manager) throw new NotFoundError('Manager not found');

  const assignments = await db.listManagerLocations(managerId);
  return assignments.map((a) => stripKeys(a));
}

export async function assignLocation(
  callerSub: string,
  managerId: string,
  body: { location_id?: string },
) {
  if (!body.location_id?.trim()) throw new ValidationError('location_id is required');

  const { org_id, user_id } = await resolveCallerOrg(callerSub);

  // Verify manager belongs to this org
  const manager = await db.getManager(org_id, managerId);
  if (!manager) throw new NotFoundError('Manager not found');

  // Verify location belongs to this org
  const location = await db.getLocation(org_id, body.location_id);
  if (!location) throw new NotFoundError('Location not found');

  // Conflict check — already assigned?
  const existing = await db.getManagerLocation(managerId, body.location_id);
  if (existing) throw new ConflictError('Manager is already assigned to this location');

  const now = new Date().toISOString();
  const assignment = {
    PK: `USER#${managerId}`,
    SK: `LOCATION#${body.location_id}`,
    user_id: managerId,
    user_type: 'MANAGER' as const,
    location_id: body.location_id,
    location_name: location.name,
    org_id,
    assigned_by: user_id,
    assigned_at: now,
  };

  await db.createManagerLocation(assignment);
  logger.info('manager location assigned', { org_id, manager_id: managerId, location_id: body.location_id });
  return stripKeys(assignment);
}

export async function removeLocation(callerSub: string, managerId: string, locationId: string) {
  const { org_id } = await resolveCallerOrg(callerSub);

  // Verify manager belongs to this org
  const manager = await db.getManager(org_id, managerId);
  if (!manager) throw new NotFoundError('Manager not found');

  // Verify assignment exists
  const existing = await db.getManagerLocation(managerId, locationId);
  if (!existing) throw new NotFoundError('Assignment not found');

  await db.deleteManagerLocation(managerId, locationId);
  logger.info('manager location removed', { org_id, manager_id: managerId, location_id: locationId });
}
