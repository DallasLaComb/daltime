import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { Organization } from '../../shared/models/web-admin/organization.model.js';
import {
  docClient,
  TABLE_NAME,
  getMetadataRecord,
  updateOrganizationRecord,
} from '../../shared/dynamo.js';

export async function getCallerLookup(
  userId: string,
): Promise<{ org_id: string; user_id: string } | null> {
  return getMetadataRecord(userId);
}

export async function getOrganization(orgId: string) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
    }),
  );
  return (result.Item as Organization | undefined) ?? null;
}

export async function updateOrganization(
  orgId: string,
  fields: { name: string; address: string; updated_at: string },
) {
  return updateOrganizationRecord(orgId, fields);
}
