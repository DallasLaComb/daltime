import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  docClient,
  TABLE_NAME,
  getMetadataRecord,
  updateOrgAndMetadataRecord,
  setEntityStatus,
  getOrgEntityRecord,
} from '../../shared/dynamo.js';
import type {
  EmployeeAvailability,
  EmployeeAvailabilityOverrides,
} from '../../shared/models/employee/availability.model.js';
import type { Employee } from '../../shared/models/org-admin/employee.model.js';

export async function getCallerLookup(
  userId: string,
): Promise<{ org_id: string; manager_id: string } | null> {
  return getMetadataRecord(userId);
}

export async function getEmployee(orgId: string, employeeId: string): Promise<Employee | null> {
  return getOrgEntityRecord<Employee>(orgId, 'EMPLOYEE', employeeId);
}

export async function listEmployeesByManager(
  orgId: string,
  managerId: string,
): Promise<Employee[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'manager_id = :managerId',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': 'EMPLOYEE#',
        ':managerId': managerId,
      },
    }),
  );
  return (result.Items ?? []) as Employee[];
}

export { createEmployeeRecord as createEmployee } from '../../shared/dynamo.js';

export async function updateEmployee(
  orgId: string,
  employeeId: string,
  fields: { first_name?: string; last_name?: string; phone?: string; employee_number?: string },
  updatedAt: string,
): Promise<Employee | null> {
  return updateOrgAndMetadataRecord<Employee>(
    { PK: `ORG#${orgId}`, SK: `EMPLOYEE#${employeeId}` },
    employeeId,
    fields,
    updatedAt,
  );
}

export async function disableEmployee(orgId: string, employeeId: string): Promise<void> {
  await setEntityStatus(
    { PK: `ORG#${orgId}`, SK: `EMPLOYEE#${employeeId}` },
    employeeId,
    'DISABLED',
  );
}

export async function getEmployeeAvailability(
  employeeId: string,
): Promise<EmployeeAvailability | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${employeeId}`, SK: 'AVAILABILITY' },
    }),
  );
  return (result.Item as EmployeeAvailability) ?? null;
}

export async function getEmployeeAvailabilityOverrides(
  employeeId: string,
): Promise<EmployeeAvailabilityOverrides | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${employeeId}`, SK: 'AVAILABILITY_OVERRIDES' },
    }),
  );
  return (result.Item as EmployeeAvailabilityOverrides) ?? null;
}

export async function enableEmployee(orgId: string, employeeId: string): Promise<void> {
  await setEntityStatus(
    { PK: `ORG#${orgId}`, SK: `EMPLOYEE#${employeeId}` },
    employeeId,
    'CONFIRMED',
  );
}
