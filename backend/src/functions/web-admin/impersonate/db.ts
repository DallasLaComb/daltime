import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ImpersonatableRole } from '@daltime/contracts';
import { docClient, TABLE_NAME } from '../../shared/dynamo.js';

// ── Session constants ────────────────────────────────────────────────────────

export const SESSION_TTL_HOURS = 8;
const AUDIT_TTL_DAYS = 90;

export interface SessionRecord {
  session_id: string;
  actor_sub: string;
  actor_web_admin_id: string;
  target_user_id: string;
  role: ImpersonatableRole;
  created_at: string;
  expires_at: string;
  ttl: number;
}

/**
 * Creates or overwrites the active session for this actor.
 * One session per actor — starting a new session replaces any prior one.
 */
export async function createSession(
  actor: { sub: string; web_admin_id: string },
  targetUserId: string,
  role: ImpersonatableRole,
): Promise<SessionRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const record: SessionRecord = {
    session_id: crypto.randomUUID(),
    actor_sub: actor.sub,
    actor_web_admin_id: actor.web_admin_id,
    target_user_id: targetUserId,
    role,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    ttl: Math.floor(expiresAt.getTime() / 1000),
  };
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: `IMPERSONATION_SESSION#${actor.sub}`, SK: 'METADATA', ...record },
    }),
  );
  return record;
}

/** Returns the active session record for an actor, or null if none exists. */
export async function getSession(actorSub: string): Promise<SessionRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `IMPERSONATION_SESSION#${actorSub}`, SK: 'METADATA' },
    }),
  );
  if (!result.Item) return null;
  const { PK: _pk, SK: _sk, ...record } = result.Item as Record<string, unknown>;
  return record as unknown as SessionRecord;
}

/**
 * Deletes the active session for this actor. Idempotent — no error if absent.
 * Keyed only by actor_sub so an actor can only end their own session.
 */
export async function deleteSession(actorSub: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `IMPERSONATION_SESSION#${actorSub}`, SK: 'METADATA' },
    }),
  );
}

/**
 * Writes a persistent audit record for one impersonated call.
 * Fire-and-forget: failures are logged but do not block the response.
 */
export async function putAuditRecord(
  session: Pick<SessionRecord, 'session_id' | 'actor_sub' | 'actor_web_admin_id' | 'target_user_id' | 'role'>,
  method: string,
  path: string,
): Promise<void> {
  const now = new Date();
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `IMPERSONATION_AUDIT#${session.session_id}`,
        SK: now.toISOString(),
        session_id: session.session_id,
        actor_sub: session.actor_sub,
        actor_web_admin_id: session.actor_web_admin_id,
        target_user_id: session.target_user_id,
        role: session.role,
        method,
        path,
        timestamp: now.toISOString(),
        ttl: Math.floor(now.getTime() / 1000) + AUDIT_TTL_DAYS * 24 * 60 * 60,
      },
    }),
  );
}

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
