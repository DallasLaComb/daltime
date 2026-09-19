import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { CreateEmployeeBody, UpdateEmployeeBody } from '@daltime/contracts';
import { stripKeys, buildEmployeeRecord } from '../../shared/dynamo.js';
import * as db from './db.js';

import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/errors.js';
import {
  enrichWithCognitoStatus,
  createCognitoEmployee,
  adminDisableUser,
  adminEnableUser,
} from '../../shared/cognito.js';

async function resolveCallerOrg(sub: string): Promise<{ org_id: string; user_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
  return lookup;
}

export async function listEmployees(
  callerSub: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);
  const items = await db.listEmployeesByOrg(org_id);
  const employees = items.map(stripKeys);

  return enrichWithCognitoStatus(employees, cognitoClient);
}

export async function createEmployee(
  callerSub: string,
  body: CreateEmployeeBody,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);

  const employeeSub = await createCognitoEmployee(
    cognitoClient,
    body.email.trim(),
    body.first_name.trim(),
    body.last_name.trim(),
    body.temp_password,
    org_id,
  );

  const employee = buildEmployeeRecord({
    employeeSub,
    email: body.email,
    first_name: body.first_name,
    last_name: body.last_name,
    phone: body.phone,
    org_id,
    manager_id: body.manager_id?.trim() ?? '',
  });

  await db.createEmployee(employee);

  return stripKeys(employee);
}

export async function updateEmployee(
  callerSub: string,
  employeeId: string,
  body: UpdateEmployeeBody,
  _cognitoClient: CognitoIdentityProviderClient,
) {
  const hasFields =
    body.first_name !== undefined ||
    body.last_name !== undefined ||
    body.phone !== undefined ||
    body.manager_id !== undefined;
  if (!hasFields) throw new ValidationError('At least one field must be provided');

  if (body.first_name !== undefined && !body.first_name.trim()) {
    throw new ValidationError('first_name cannot be empty');
  }
  if (body.last_name !== undefined && !body.last_name.trim()) {
    throw new ValidationError('last_name cannot be empty');
  }

  const { org_id } = await resolveCallerOrg(callerSub);

  const lookup = await db.getEmployeeReverseLookup(employeeId);
  if (!lookup) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this employee');

  const fields: { first_name?: string; last_name?: string; phone?: string; manager_id?: string } =
    {};
  if (body.first_name !== undefined) fields.first_name = body.first_name.trim();
  if (body.last_name !== undefined) fields.last_name = body.last_name.trim();
  if (body.phone !== undefined) fields.phone = body.phone.trim();
  if (body.manager_id !== undefined) fields.manager_id = body.manager_id.trim();

  const updated = await db.updateEmployee(org_id, employeeId, fields, new Date().toISOString());
  return stripKeys(updated!);
}

export async function disableEmployee(
  callerSub: string,
  employeeId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);

  const lookup = await db.getEmployeeReverseLookup(employeeId);
  if (!lookup) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this employee');

  await adminDisableUser(cognitoClient, lookup.email);
  await db.disableEmployee(org_id, employeeId);
}

export async function enableEmployee(
  callerSub: string,
  employeeId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id } = await resolveCallerOrg(callerSub);

  const lookup = await db.getEmployeeReverseLookup(employeeId);
  if (!lookup) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (lookup.org_id !== org_id) throw new ForbiddenError('Not authorized to manage this employee');

  await adminEnableUser(cognitoClient, lookup.email);
  await db.enableEmployee(org_id, employeeId);
}
