import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
  InvalidPasswordException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { ManagerRecord, CreateManagerBody, UpdateManagerBody } from '@daltime/contracts';
import { stripKeys } from '../../shared/dynamo.js';
import * as db from './db.js';

import {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import {
  enrichWithCognitoStatus,
  adminDisableUser,
  adminEnableUser,
} from '../../shared/cognito.js';

const USER_POOL_ID = process.env['USER_POOL_ID']!;

/** Resolve the caller's org_id from their JWT sub. */
async function resolveCallerOrg(sub: string): Promise<{ org_id: string; user_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function listManagers(
  callerSub: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);
  const items = await db.listManagersByOrg(org_id);
  const managers = items.map(stripKeys);

  return enrichWithCognitoStatus(managers, cognitoClient);
}

export async function createManager(
  callerSub: string,
  body: CreateManagerBody,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, user_id: orgAdminId } = await resolveCallerOrg(callerSub);

  let managerSub: string;
  try {
    const createResult = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: body.email.trim(),
        TemporaryPassword: body.temp_password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'name', Value: `${body.first_name.trim()} ${body.last_name.trim()}` },
          { Name: 'email', Value: body.email.trim() },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:org_id', Value: org_id },
        ],
      }),
    );
    managerSub = createResult.User!.Attributes!.find((a) => a.Name === 'sub')!.Value!;
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
      GroupName: 'Manager',
    }),
  );

  const now = new Date().toISOString();
  const manager: ManagerRecord = {
    PK: `ORG#${org_id}`,
    SK: `MANAGER#${managerSub}`,
    GSI1PK: 'MANAGER',
    GSI1SK: now,
    manager_id: managerSub,
    first_name: body.first_name.trim(),
    last_name: body.last_name.trim(),
    email: body.email.trim(),
    phone: body.phone?.trim() ?? '',
    org_id,
    org_admin_id: orgAdminId,
    status: 'FORCE_CHANGE_PASSWORD',
    employee_count: 0,
    created_at: now,
    updated_at: now,
  };

  await db.createManager(manager);
  await db.incrementManagerCount(org_id, orgAdminId);
  logger.info('manager created', { org_id, manager_id: managerSub });

  return stripKeys(manager);
}

export async function updateManager(
  callerSub: string,
  managerId: string,
  body: UpdateManagerBody,
  _cognitoClient: CognitoIdentityProviderClient,
) {
  const hasFields =
    body.first_name !== undefined || body.last_name !== undefined || body.phone !== undefined;
  if (!hasFields) throw new ValidationError('At least one field must be provided');

  if (body.first_name !== undefined && !body.first_name.trim()) {
    throw new ValidationError('first_name cannot be empty');
  }
  if (body.last_name !== undefined && !body.last_name.trim()) {
    throw new ValidationError('last_name cannot be empty');
  }

  const { org_id } = await resolveCallerOrg(callerSub);

  const lookup = await db.getManagerReverseLookup(managerId);
  if (!lookup) throw new NotFoundError(`Manager '${managerId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this manager');

  const fields: { first_name?: string; last_name?: string; phone?: string } = {};
  if (body.first_name !== undefined) fields.first_name = body.first_name.trim();
  if (body.last_name !== undefined) fields.last_name = body.last_name.trim();
  if (body.phone !== undefined) fields.phone = body.phone.trim();

  const updated = await db.updateManager(org_id, managerId, fields, new Date().toISOString());
  logger.info('manager updated', { org_id, manager_id: managerId });
  return stripKeys(updated!);
}

export async function disableManager(
  callerSub: string,
  managerId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, user_id: orgAdminId } = await resolveCallerOrg(callerSub);

  const lookup = await db.getManagerReverseLookup(managerId);
  if (!lookup) throw new NotFoundError(`Manager '${managerId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this manager');

  await adminDisableUser(cognitoClient, lookup.email);
  await db.disableManager(org_id, managerId);
  await db.decrementManagerCount(org_id, orgAdminId);
  logger.info('manager disabled', { org_id, manager_id: managerId });
}

export async function enableManager(
  callerSub: string,
  managerId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);

  const lookup = await db.getManagerReverseLookup(managerId);
  if (!lookup) throw new NotFoundError(`Manager '${managerId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this manager');

  await adminEnableUser(cognitoClient, lookup.email);
  await db.enableManager(org_id, managerId);
  logger.info('manager enabled', { org_id, manager_id: managerId });
}
