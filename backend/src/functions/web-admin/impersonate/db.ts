import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ImpersonatableRole } from '@daltime/contracts';
import { docClient, TABLE_NAME } from '../../shared/dynamo.js';

const ROLE_SK_PREFIX: Record<string, string> = {
  OrgAdmin: 'USER#',
  Manager: 'MANAGER#',
  Employee: 'EMPLOYEE#',
};

export interface UserRow {
  PK: string;
  SK: string;
  [key: string]: unknown;
}

/** List all primary records for a given org + role by querying PK = ORG#<orgId>. */
export async function listUsersByOrgAndRole(orgId: string, role: string): Promise<UserRow[]> {
  const skPrefix = ROLE_SK_PREFIX[role];
  if (!skPrefix) return [];

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': skPrefix,
      },
    }),
  );
  return (result.Items ?? []) as UserRow[];
}

/**
 * Fetch the reverse-lookup record for any user role. Used both to build
 * `/context` responses and, in the generic dispatcher, as the existence
 * check that gates whether an impersonated userId may be forwarded to a
 * real handler at all (fail-closed if the user doesn't exist).
 */
export async function getUserReverseLookup(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
    }),
  );
  return (result.Item as Record<string, unknown>) ?? null;
}

/**
 * True only when `userId` is a real member of `role`.
 *
 * Two reads, both authoritative and DynamoDB-only (role Lambdas have no Cognito
 * permissions): the user's reverse-lookup record yields their `org_id`, then the
 * role-specific primary record `ORG#<org_id> / <ROLE_PREFIX><userId>` must exist.
 * That is the same record the impersonation picker lists, so "impersonatable" and
 * "verifiable" cannot disagree. A user who exists but holds a different role (an
 * Employee id paired with a /manager route) is rejected rather than being handed a
 * Manager identity.
 */
export async function isRoleMember(userId: string, role: ImpersonatableRole): Promise<boolean> {
  const metadata = await getUserReverseLookup(userId);
  const orgId = metadata?.['org_id'];
  if (typeof orgId !== 'string' || !orgId) return false;

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `${ROLE_SK_PREFIX[role]}${userId}` },
    }),
  );
  return Boolean(result.Item);
}
