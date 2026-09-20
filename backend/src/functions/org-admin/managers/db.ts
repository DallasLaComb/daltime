import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  docClient,
  TABLE_NAME,
  getMetadataRecord,
  updateOrgAndMetadataRecord,
  setEntityStatus,
  getOrgEntityRecord,
} from '../../shared/dynamo.js';
import type { ManagerRecord } from '@daltime/contracts';

/** Resolve the caller's org_id and user_id from the reverse-lookup record. */
export async function getCallerLookup(
  userId: string,
): Promise<{ org_id: string; user_id: string } | null> {
  return getMetadataRecord(userId);
}

/** List all managers for a given org by querying PK = ORG#<orgId>, SK begins_with MANAGER#. */
export async function listManagersByOrg(orgId: string): Promise<ManagerRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': 'MANAGER#',
      },
    }),
  );
  return (result.Items ?? []) as ManagerRecord[];
}

/** Get a single manager by org + managerId. */
export async function getManager(orgId: string, managerId: string): Promise<ManagerRecord | null> {
  return getOrgEntityRecord<ManagerRecord>(orgId, 'MANAGER', managerId);
}

/** Fetch the reverse-lookup record for a manager. */
export async function getManagerReverseLookup(
  managerId: string,
): Promise<{ manager_id: string; org_id: string; email: string } | null> {
  return getMetadataRecord(managerId);
}

/** Write both the primary record and the reverse-lookup record. */
export async function createManager(manager: ManagerRecord): Promise<void> {
  const primary: ManagerRecord = {
    ...manager,
    GSI1PK: 'MANAGER',
    GSI1SK: manager.created_at,
  };

  const reverseLookup = {
    PK: `USER#${manager.manager_id}`,
    SK: 'METADATA',
    manager_id: manager.manager_id,
    email: manager.email,
    first_name: manager.first_name,
    last_name: manager.last_name,
    org_id: manager.org_id,
    status: manager.status,
    created_at: manager.created_at,
  };

  await Promise.all([
    docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: primary })),
    docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: reverseLookup })),
  ]);
}

/** Update mutable fields on both the primary and reverse-lookup records. */
export async function updateManager(
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

/** Update status to DISABLED on the primary and reverse-lookup records. */
export async function disableManager(orgId: string, managerId: string): Promise<void> {
  await setEntityStatus({ PK: `ORG#${orgId}`, SK: `MANAGER#${managerId}` }, managerId, 'DISABLED');
}

/** Update status to CONFIRMED on the primary and reverse-lookup records (re-enable). */
export async function enableManager(orgId: string, managerId: string): Promise<void> {
  await setEntityStatus({ PK: `ORG#${orgId}`, SK: `MANAGER#${managerId}` }, managerId, 'CONFIRMED');
}

/** Atomically increment manager_count on the OrgAdmin's user record. */
export async function incrementManagerCount(orgId: string, orgAdminId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `USER#${orgAdminId}` },
      UpdateExpression: 'ADD manager_count :inc',
      ExpressionAttributeValues: { ':inc': 1 },
    }),
  );
}

/** Atomically decrement manager_count on the OrgAdmin's user record (floor at 0). */
export async function decrementManagerCount(orgId: string, orgAdminId: string): Promise<void> {
  await docClient
    .send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ORG#${orgId}`, SK: `USER#${orgAdminId}` },
        UpdateExpression: 'SET manager_count = if_not_exists(manager_count, :zero) - :dec',
        ConditionExpression: 'manager_count > :zero',
        ExpressionAttributeValues: { ':dec': 1, ':zero': 0 },
      }),
    )
    .catch(() => {
      // Condition failed means count is already 0 — safe to ignore.
    });
}
