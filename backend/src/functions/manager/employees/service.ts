import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { stripKeys, buildEmployeeRecord } from '../../shared/dynamo.js';
import * as db from './db.js';

import {
  CreateManagerEmployeeBody,
  UpdateManagerEmployeeBody,
} from '@daltime/contracts';
import { NotFoundError, ForbiddenError } from '../../shared/errors.js';
import {
  enrichWithCognitoStatus,
  createCognitoEmployee,
  adminDisableUser,
  adminEnableUser,
} from '../../shared/cognito.js';

async function resolveCallerManager(sub: string): Promise<{ org_id: string; manager_id: string }> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller could not be resolved');
  return { org_id: lookup.org_id, manager_id: lookup.manager_id };
}

export async function listEmployees(
  callerSub: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);
  const items = await db.listEmployeesByManager(org_id, manager_id);
  const employees = items.map(stripKeys);

  return enrichWithCognitoStatus(employees, cognitoClient);
}

export async function createEmployee(
  callerSub: string,
  body: CreateManagerEmployeeBody,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);

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
    manager_id,
  });

  await db.createEmployee(employee);

  return stripKeys(employee);
}

export async function updateEmployee(
  callerSub: string,
  employeeId: string,
  body: UpdateManagerEmployeeBody,
  _cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);

  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (employee.manager_id !== manager_id)
    throw new ForbiddenError('Not authorized to manage this employee');

  const fields: { first_name?: string; last_name?: string; phone?: string } = {};
  if (body.first_name !== undefined) fields.first_name = body.first_name.trim();
  if (body.last_name !== undefined) fields.last_name = body.last_name.trim();
  if (body.phone !== undefined) fields.phone = body.phone.trim();

  const updated = await db.updateEmployee(org_id, employeeId, fields, new Date().toISOString());
  return stripKeys(updated!);
}

export async function disableEmployee(
  callerSub: string,
  employeeId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);

  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (employee.manager_id !== manager_id)
    throw new ForbiddenError('Not authorized to manage this employee');

  await adminDisableUser(cognitoClient, employee.email);
  await db.disableEmployee(org_id, employeeId);
}

export async function getEmployeeAvailabilityForManager(
  callerSub: string,
  employeeId: string,
): Promise<Record<string, unknown>> {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);
  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (employee.manager_id !== manager_id) throw new ForbiddenError('Not authorized');
  const record = await db.getEmployeeAvailability(employeeId);
  if (!record) return { employee_id: employeeId, schedule: null, updated_at: null };
  return stripKeys(record);
}

export async function getEmployeeAvailabilityOverridesForManager(
  callerSub: string,
  employeeId: string,
): Promise<Record<string, unknown>> {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);
  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (employee.manager_id !== manager_id) throw new ForbiddenError('Not authorized');
  const record = await db.getEmployeeAvailabilityOverrides(employeeId);
  if (!record) return { employee_id: employeeId, overrides: {}, updated_at: null };
  return stripKeys(record);
}

export async function enableEmployee(
  callerSub: string,
  employeeId: string,
  cognitoClient: CognitoIdentityProviderClient,
) {
  const { org_id, manager_id } = await resolveCallerManager(callerSub);

  const employee = await db.getEmployee(org_id, employeeId);
  if (!employee) throw new NotFoundError(`Employee '${employeeId}' not found`);
  if (employee.manager_id !== manager_id)
    throw new ForbiddenError('Not authorized to manage this employee');

  await adminEnableUser(cognitoClient, employee.email);
  await db.enableEmployee(org_id, employeeId);
}
