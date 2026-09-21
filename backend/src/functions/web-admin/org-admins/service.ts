import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
  InvalidPasswordException,
} from '@aws-sdk/client-cognito-identity-provider';
import type {
  OrgAdminUser,
  CreateOrgAdminBody,
} from '../../shared/models/web-admin/org-admin-user.model.js';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';
import * as orgDb from '../organizations/db.js';

import { ValidationError, ConflictError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { EMAIL_REGEX } from '../../shared/validation.js';
import {
  enrichWithCognitoStatus,
  adminDisableUser,
  adminEnableUser,
} from '../../shared/cognito.js';

const USER_POOL_ID = process.env['USER_POOL_ID']!;

/**
 * List all OrgAdmins for a given org, enriched with live Cognito status.
 * Returns an array of public-facing records (DynamoDB keys stripped).
 */
export async function listOrgAdmins(orgId: string, cognitoClient: CognitoIdentityProviderClient) {
  const items = await db.listOrgAdminsByOrg(orgId);
  const admins = items.map(stripKeys);

  return enrichWithCognitoStatus(admins, cognitoClient);
}

/**
 * Create a new OrgAdmin Cognito user and write their primary and reverse-lookup
 * DynamoDB records. Stamps `modified_by_web_admin_id` on both records so the
 * creating WebAdmin is recorded for audit purposes.
 */
export async function createOrgAdmin(
  orgId: string,
  body: CreateOrgAdminBody,
  cognitoClient: CognitoIdentityProviderClient,
  webAdminId: string,
) {
  if (!body.email?.trim()) throw new ValidationError('email is required');
  if (!EMAIL_REGEX.test(body.email.trim()))
    throw new ValidationError('email must be a valid email address');
  if (!body.name?.trim()) throw new ValidationError('name is required');
  if (!body.temp_password?.trim()) throw new ValidationError('temp_password is required');

  const org = await orgDb.getOrganizationById(orgId);
  if (!org) throw new NotFoundError(`Organization '${orgId}' not found`);

  let userSub: string;
  try {
    const createResult = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: body.email.trim(),
        TemporaryPassword: body.temp_password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'name', Value: body.name.trim() },
          { Name: 'email', Value: body.email.trim() },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:org_id', Value: orgId },
        ],
      }),
    );
    userSub = createResult.User!.Attributes!.find((a) => a.Name === 'sub')!.Value!;
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      throw new ConflictError('A user with this email already exists');
    }
    if (err instanceof InvalidPasswordException) {
      throw new ValidationError((err as Error).message);
    }
    throw err;
  }

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: body.email.trim(),
      GroupName: 'OrgAdmin',
    }),
  );

  const now = new Date().toISOString();
  const user: OrgAdminUser = {
    PK: `ORG#${orgId}`,
    SK: `USER#${userSub}`,
    GSI1PK: 'ORG_ADMIN',
    GSI1SK: now,
    user_id: userSub,
    email: body.email.trim(),
    name: body.name.trim(),
    org_id: orgId,
    status: 'FORCE_CHANGE_PASSWORD',
    created_at: now,
  };

  await db.createOrgAdminUser(user, webAdminId);
  await db.incrementOrgAdminCount(orgId);
  logger.info('org admin created', { org_id: orgId, user_id: userSub });

  return stripKeys(user);
}

/**
 * Disable an OrgAdmin in both Cognito and DynamoDB. Stamps
 * `modified_by_web_admin_id` on the DynamoDB records for audit purposes.
 */
export async function disableOrgAdmin(
  orgId: string,
  userId: string,
  cognitoClient: CognitoIdentityProviderClient,
  webAdminId: string,
) {
  const lookup = await db.getOrgAdminReverseLookup(userId);
  if (!lookup) throw new NotFoundError(`User '${userId}' not found`);

  await adminDisableUser(cognitoClient, lookup.email);
  await db.disableOrgAdminUser(orgId, userId, webAdminId);
  await db.decrementOrgAdminCount(orgId);
  logger.info('org admin disabled', { org_id: orgId, user_id: userId });
}

/**
 * Re-enable an OrgAdmin in both Cognito and DynamoDB. Stamps
 * `modified_by_web_admin_id` on the DynamoDB records for audit purposes.
 */
export async function enableOrgAdmin(
  orgId: string,
  userId: string,
  cognitoClient: CognitoIdentityProviderClient,
  webAdminId: string,
) {
  const lookup = await db.getOrgAdminReverseLookup(userId);
  if (!lookup) throw new NotFoundError(`User '${userId}' not found`);

  await adminEnableUser(cognitoClient, lookup.email);
  await db.enableOrgAdminUser(orgId, userId, webAdminId);
  await db.incrementOrgAdminCount(orgId);
  logger.info('org admin enabled', { org_id: orgId, user_id: userId });
}
