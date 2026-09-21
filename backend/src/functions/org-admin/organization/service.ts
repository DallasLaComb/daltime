import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

async function resolveCallerOrg(sub: string): Promise<{ org_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function getOrganization(callerSub: string) {
  const { org_id } = await resolveCallerOrg(callerSub);
  const item = await db.getOrganization(org_id);
  if (!item) throw new NotFoundError('Organization not found');
  return stripKeys(item);
}

export async function updateOrganization(
  callerSub: string,
  body: { name?: string; address?: string },
) {
  if (!body.name?.trim() && !body.address?.trim()) {
    throw new ValidationError('At least one of name or address is required');
  }

  const { org_id } = await resolveCallerOrg(callerSub);
  const existing = await db.getOrganization(org_id);
  if (!existing) throw new NotFoundError('Organization not found');

  const updated = await db.updateOrganization(org_id, {
    name: body.name?.trim() ?? (existing['name'] as string),
    address: body.address?.trim() ?? (existing['address'] as string),
    updated_at: new Date().toISOString(),
  });
  logger.info('organization updated', { org_id });

  return stripKeys(updated);
}
