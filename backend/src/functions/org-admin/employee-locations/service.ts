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

export async function listLocations(callerSub: string, employeeId: string) {
  const { org_id } = await resolveCallerOrg(callerSub);

  // Verify the employee belongs to this org
  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError('Employee not found');

  const assignments = await db.listEmployeeLocations(employeeId);
  return assignments.map((a) => stripKeys(a));
}

export async function assignLocation(
  callerSub: string,
  employeeId: string,
  body: { location_id?: string },
) {
  if (!body.location_id?.trim()) throw new ValidationError('location_id is required');

  const { org_id, user_id } = await resolveCallerOrg(callerSub);

  // Verify employee belongs to this org
  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError('Employee not found');

  // Verify location belongs to this org
  const location = await db.getLocation(org_id, body.location_id);
  if (!location) throw new NotFoundError('Location not found');

  // Conflict check — already assigned?
  const existing = await db.getEmployeeLocation(employeeId, body.location_id);
  if (existing) throw new ConflictError('Employee is already assigned to this location');

  const now = new Date().toISOString();
  const assignment = {
    PK: `USER#${employeeId}`,
    SK: `LOCATION#${body.location_id}`,
    user_id: employeeId,
    user_type: 'EMPLOYEE' as const,
    location_id: body.location_id,
    location_name: location.name,
    org_id,
    assigned_by: user_id,
    assigned_at: now,
  };

  await db.createEmployeeLocation(assignment);
  logger.info('employee location assigned', { org_id, employee_id: employeeId, location_id: body.location_id });
  return stripKeys(assignment);
}

export async function removeLocation(callerSub: string, employeeId: string, locationId: string) {
  const { org_id } = await resolveCallerOrg(callerSub);

  // Verify employee belongs to this org
  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError('Employee not found');

  // Verify assignment exists
  const existing = await db.getEmployeeLocation(employeeId, locationId);
  if (!existing) throw new NotFoundError('Assignment not found');

  await db.deleteEmployeeLocation(employeeId, locationId);
  logger.info('employee location removed', { org_id, employee_id: employeeId, location_id: locationId });
}
