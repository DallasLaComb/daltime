import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, getMetadataRecord } from '../../shared/dynamo.js';
import type { EmployeeAvailabilityOverridesRecord } from '@daltime/contracts';

export async function getCallerLookup(
  employeeId: string,
): Promise<{ org_id: string; employee_id: string } | null> {
  return getMetadataRecord(employeeId);
}

export async function getAvailabilityOverrides(
  employeeId: string,
): Promise<EmployeeAvailabilityOverridesRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${employeeId}`, SK: 'AVAILABILITY_OVERRIDES' },
    }),
  );
  return (result.Item as EmployeeAvailabilityOverridesRecord) ?? null;
}

export async function upsertAvailabilityOverrides(
  record: EmployeeAvailabilityOverridesRecord,
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    }),
  );
}
