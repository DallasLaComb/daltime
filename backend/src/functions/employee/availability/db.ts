import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, getMetadataRecord } from '../../shared/dynamo.js';
import type { EmployeeAvailabilityRecord } from '@daltime/contracts';

export async function getCallerLookup(
  employeeId: string,
): Promise<{ org_id: string; employee_id: string } | null> {
  return getMetadataRecord(employeeId);
}

export async function getAvailability(
  employeeId: string,
): Promise<EmployeeAvailabilityRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${employeeId}`, SK: 'AVAILABILITY' },
    }),
  );
  return (result.Item as EmployeeAvailabilityRecord) ?? null;
}

export async function upsertAvailability(record: EmployeeAvailabilityRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    }),
  );
}
