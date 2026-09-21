import { randomUUID } from 'node:crypto';
import type {
  Organization,
  CreateOrganizationBody,
  UpdateOrganizationBody,
} from '../../shared/models/web-admin/organization.model.js';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import { ValidationError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export async function listOrganizations() {
  const items = await db.listOrganizations();
  return items.map(stripKeys);
}

export async function getOrganization(orgId: string) {
  const item = await db.getOrganizationById(orgId);
  return item ? stripKeys(item) : null;
}

/**
 * Create a new organization and stamp `modified_by_web_admin_id` on the item
 * so the creating WebAdmin is recorded for audit purposes.
 */
export async function createOrganization(body: CreateOrganizationBody, webAdminId: string) {
  if (!body.name?.trim()) throw new ValidationError('name is required');
  if (!body.address?.trim()) throw new ValidationError('address is required');

  const id = randomUUID();
  const now = new Date().toISOString();
  const org: Organization = {
    PK: `ORG#${id}`,
    SK: 'METADATA',
    GSI1PK: 'ORG',
    GSI1SK: now,
    org_id: id,
    name: body.name.trim(),
    address: body.address.trim(),
    created_at: now,
    updated_at: now,
    org_admin_count: 0,
  };

  await db.createOrganization(org, webAdminId);
  logger.info('organization created', { org_id: id, web_admin_id: webAdminId });
  return stripKeys(org);
}

/**
 * Update an existing organization's name and/or address, stamping
 * `modified_by_web_admin_id` on the item for audit purposes.
 */
export async function updateOrganization(
  orgId: string,
  body: UpdateOrganizationBody,
  webAdminId: string,
) {
  const existing = await db.getOrganizationById(orgId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = await db.updateOrganization(
    orgId,
    {
      name: body.name?.trim() ?? (existing['name'] as string),
      address: body.address?.trim() ?? (existing['address'] as string),
      updated_at: now,
    },
    webAdminId,
  );
  logger.info('organization updated', { org_id: orgId, web_admin_id: webAdminId });

  return stripKeys(updated);
}

/**
 * Delete (hard delete) an organization by its ID.
 * Returns false if the org does not exist, true on successful deletion.
 * Stamps `modified_by_web_admin_id` on the delete operation is not applicable
 * for a hard delete (the item is removed), so webAdminId is accepted for
 * future use / soft-delete migration consistency.
 */
export async function deleteOrganization(orgId: string, webAdminId: string) {
  const existing = await db.getOrganizationById(orgId);
  if (!existing) return false;
  await db.deleteOrganization(orgId, webAdminId);
  logger.info('organization deleted', { org_id: orgId, web_admin_id: webAdminId });
  return true;
}
