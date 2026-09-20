import type { ManagerRecord } from '@daltime/contracts';
import {
  getMetadataRecord,
  updateOrgAndMetadataRecord,
  getOrgEntityRecord,
} from '../../shared/dynamo.js';

export async function getCallerLookup(managerId: string): Promise<{ org_id: string } | null> {
  return getMetadataRecord(managerId);
}

export async function getRecord(orgId: string, managerId: string): Promise<ManagerRecord | null> {
  return getOrgEntityRecord<ManagerRecord>(orgId, 'MANAGER', managerId);
}

export async function updateRecord(
  orgId: string,
  managerId: string,
  fields: { first_name?: string; last_name?: string; phone?: string },
  updatedAt: string,
): Promise<ManagerRecord | null> {
  return updateOrgAndMetadataRecord<ManagerRecord>(
    { PK: `ORG#${orgId}`, SK: `MANAGER#${managerId}` },
    managerId,
    fields,
    updatedAt,
  );
}
