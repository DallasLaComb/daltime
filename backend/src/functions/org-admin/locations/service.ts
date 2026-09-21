import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; user_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function getLocations(callerSub: string) {
  const { org_id } = await resolveCallerOrg(callerSub);
  const locations = await db.listLocations(org_id);
  return locations.map((l) => stripKeys(l));
}

export async function createLocation(callerSub: string, body: { name?: string; address?: string }) {
  const trimmedName = body.name?.trim() ?? '';
  if (!trimmedName) throw new ValidationError('name is required');
  if (trimmedName.length > 100) throw new ValidationError('name must be 100 characters or fewer');
  if (body.address !== undefined && body.address.trim().length > 200) {
    throw new ValidationError('address must be 200 characters or fewer');
  }

  const { org_id, user_id } = await resolveCallerOrg(callerSub);
  const locationId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${org_id}`,
    SK: `LOCATION#${locationId}`,
    location_id: locationId,
    org_id,
    name: trimmedName,
    ...(body.address?.trim() ? { address: body.address.trim() } : {}),
    created_by: user_id,
    created_at: now,
    updated_at: now,
  };

  await db.createLocation(item);
  logger.info('location created', { org_id, location_id: locationId });
  return stripKeys(item);
}

export async function updateLocation(
  callerSub: string,
  locationId: string,
  body: { name?: string; address?: string },
) {
  const hasFields = body.name !== undefined || body.address !== undefined;
  if (!hasFields) throw new ValidationError('At least one field must be provided');

  if (body.name !== undefined) {
    const trimmedName = body.name.trim();
    if (!trimmedName) throw new ValidationError('name cannot be empty');
    if (trimmedName.length > 100) throw new ValidationError('name must be 100 characters or fewer');
  }

  if (body.address !== undefined && body.address.trim().length > 200) {
    throw new ValidationError('address must be 200 characters or fewer');
  }

  const { org_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getLocation(org_id, locationId);
  if (!existing) throw new NotFoundError('Location not found');

  const fields: { name?: string; address?: string | null } = {};
  if (body.name !== undefined) fields.name = body.name.trim();
  if (body.address !== undefined) {
    // Empty string after trim → null signals db.ts to REMOVE the attribute
    fields.address = body.address.trim() || null;
  }

  const updated = await db.updateLocation(org_id, locationId, fields, new Date().toISOString());
  logger.info('location updated', { org_id, location_id: locationId });
  return stripKeys(updated!);
}

export async function removeLocation(callerSub: string, locationId: string) {
  const { org_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getLocation(org_id, locationId);
  if (!existing) throw new NotFoundError('Location not found');
  await db.deleteLocation(org_id, locationId);
  logger.info('location removed', { org_id, location_id: locationId });
}
