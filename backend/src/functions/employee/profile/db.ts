import {
  getMetadataRecord,
  updateOrgAndMetadataRecord,
  getOrgEntityRecord,
} from '../../shared/dynamo.js';
import type { EmployeeRecord } from '@daltime/contracts';

export async function getCallerLookup(
  employeeId: string,
): Promise<{ org_id: string; employee_id: string } | null> {
  return getMetadataRecord(employeeId);
}

export async function getRecord(orgId: string, employeeId: string): Promise<EmployeeRecord | null> {
  return getOrgEntityRecord<EmployeeRecord>(orgId, 'EMPLOYEE', employeeId);
}

export async function updateRecord(
  orgId: string,
  employeeId: string,
  fields: { first_name?: string; last_name?: string; phone?: string },
  updatedAt: string,
): Promise<EmployeeRecord | null> {
  return updateOrgAndMetadataRecord<EmployeeRecord>(
    { PK: `ORG#${orgId}`, SK: `EMPLOYEE#${employeeId}` },
    employeeId,
    fields,
    updatedAt,
  );
}
