import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type {
  ImpersonateUserSummary,
  ImpersonateContextResponse,
  ImpersonatableRole,
} from '@daltime/contracts';
import * as db from './db.js';

import { NotFoundError } from '../../shared/errors.js';

const USER_POOL_ID = process.env.USER_POOL_ID!;

const VALID_ROLES = new Set<ImpersonatableRole>(['OrgAdmin', 'Manager', 'Employee']);

/** Resolve the Cognito group (role) for a given user sub. */
async function resolveRole(
  userId: string,
  cognitoClient: CognitoIdentityProviderClient,
): Promise<ImpersonatableRole | null> {
  const response = await cognitoClient.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }),
  );
  const group = (response.Groups ?? []).find((g) =>
    VALID_ROLES.has(g.GroupName as ImpersonatableRole),
  );
  if (!group?.GroupName) return null;
  return group.GroupName as ImpersonatableRole;
}

/** Build a display name from a raw DynamoDB row (handles both name and first_name/last_name). */
function buildDisplayName(row: Record<string, unknown>): string {
  if (typeof row['name'] === 'string' && row['name']) return row['name'];
  const first = typeof row['first_name'] === 'string' ? row['first_name'] : '';
  const last = typeof row['last_name'] === 'string' ? row['last_name'] : '';
  return `${first} ${last}`.trim() || 'Unknown';
}

/** List all users for an org + role that can be impersonated. */
export async function listImpersonatableUsers(
  orgId: string,
  role: ImpersonatableRole,
): Promise<ImpersonateUserSummary[]> {
  const rows = await db.listUsersByOrgAndRole(orgId, role);

  return rows.map((row) => {
    // SK is always "<ROLE>#<userId>" — extract the ID after the first "#"
    // This avoids ambiguity: employee records carry a manager_id field which
    // would otherwise be picked up before employee_id in a fallback chain.
    const skParts = row.SK.split('#');
    const userId = skParts.length >= 2 ? skParts.slice(1).join('#') : '';

    return {
      user_id: userId,
      display_name: buildDisplayName(row),
      email: (row['email'] as string) ?? '',
      status: (row['status'] as string) ?? '',
      org_id: (row['org_id'] as string) ?? orgId,
    };
  });
}

/** Fetch a user's full context (profile + role) for starting impersonation. */
export async function getUserContext(
  userId: string,
  cognitoClient: CognitoIdentityProviderClient,
): Promise<ImpersonateContextResponse> {
  const row = await db.getUserReverseLookup(userId);
  if (!row) throw new NotFoundError('User not found');

  const role = await resolveRole(userId, cognitoClient);
  if (!role) throw new NotFoundError('User has no recognised role');

  return {
    user_id: userId,
    role,
    display_name: buildDisplayName(row),
    email: (row['email'] as string) ?? '',
    org_id: (row['org_id'] as string) ?? '',
    status: (row['status'] as string) ?? '',
  };
}
