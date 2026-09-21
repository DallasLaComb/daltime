import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { enrichSingleWithCognitoStatus } from '../../shared/cognito.js';

const USER_POOL_ID = process.env['USER_POOL_ID']!;

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; user_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function getProfile(callerSub: string, cognitoClient: CognitoIdentityProviderClient) {
  const { org_id, user_id } = await resolveCallerOrg(callerSub);

  const record = await db.getOrgAdminRecord(org_id, user_id);
  if (!record) throw new NotFoundError('Profile not found');

  return enrichSingleWithCognitoStatus(stripKeys(record), cognitoClient);
}

export async function updateProfile(
  callerSub: string,
  body: { name?: string },
  cognitoClient: CognitoIdentityProviderClient,
) {
  if (!body.name?.trim()) throw new ValidationError('name is required');

  const { org_id, user_id } = await resolveCallerOrg(callerSub);

  const record = await db.getOrgAdminRecord(org_id, user_id);
  if (!record) throw new NotFoundError('Profile not found');

  const name = body.name.trim();

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: record.email,
      UserAttributes: [{ Name: 'name', Value: name }],
    }),
  );

  await db.updateOrgAdminName(org_id, user_id, name, new Date().toISOString());
  logger.info('profile updated', { user_id, org_id });

  return { ...stripKeys(record), name };
}
