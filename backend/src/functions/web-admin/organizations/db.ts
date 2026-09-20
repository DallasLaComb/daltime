import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, GSI1_INDEX } from '../../shared/dynamo.js';
import type { Organization } from '../../shared/models/web-admin/organization.model.js';

/** List all organizations via the GSI1 partition key 'ORG'. */
export async function listOrganizations() {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ORG' },
    }),
  );
  return (result.Items ?? []) as Organization[];
}

/** Fetch a single organization by its org_id (base table GetItem). */
export async function getOrganizationById(orgId: string) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
    }),
  );
  return (result.Item as Organization | undefined) ?? null;
}

/**
 * Write a new organization item. Stamps `modified_by_web_admin_id` on the
 * item so the creating WebAdmin is captured for audit purposes.
 */
export async function createOrganization(org: Organization, webAdminId: string) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...org, modified_by_web_admin_id: webAdminId },
    }),
  );
}

/**
 * Update mutable fields on an organization and stamp `modified_by_web_admin_id`
 * to record which WebAdmin last changed the record. Written inline rather than
 * through the shared `updateOrganizationRecord` helper so the extra audit field
 * can be included without widening the shared helper's fixed type signature.
 */
export async function updateOrganization(
  orgId: string,
  fields: { name: string; address: string; updated_at: string },
  webAdminId: string,
): Promise<Organization> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET #name = :name, address = :address, updated_at = :updated_at, modified_by_web_admin_id = :webAdminId',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':name': fields.name,
        ':address': fields.address,
        ':updated_at': fields.updated_at,
        ':webAdminId': webAdminId,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as Organization;
}

/**
 * Hard-delete an organization by its org_id.
 * webAdminId is accepted for API consistency even though a hard-delete removes
 * the item — callers still must be authorized before reaching this function.
 */
export async function deleteOrganization(orgId: string, _webAdminId: string) {
  await docClient.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `ORG#${orgId}`, SK: 'METADATA' } }),
  );
}
