import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, getMetadataRecord } from '../../shared/dynamo.js';
import type { ShiftRecord } from '@daltime/contracts';

/**
 * Fetch the USER#<userId>/METADATA record to resolve the caller's org_id and
 * employee_id. Returns null if the record does not exist (caller not provisioned).
 */
export async function getCallerLookup(
  userId: string,
): Promise<{ org_id: string; employee_id: string } | null> {
  return getMetadataRecord(userId);
}

/**
 * Query all shifts for a given org on a specific date that are:
 *   1. Marked available_for_pickup = true (the assigned employee offered them up)
 *   2. Assigned to a different employee than the caller (self-pickup not permitted)
 *   3. Published (not draft) or have no status attribute
 *
 * Returns shifts from other employees in the same org that the caller can pick up.
 * Uses PK = ORG#<orgId>, SK begins_with SHIFT# with a FilterExpression — no GSI
 * required because the base key condition already narrows to one org's shifts.
 */
export async function listAvailableShifts(
  orgId: string,
  callerId: string,
  date: string,
): Promise<ShiftRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression:
        '#date = :date AND available_for_pickup = :true AND employee_id <> :callerId AND (#status = :published OR attribute_not_exists(#status))',
      ExpressionAttributeNames: {
        '#date': 'date',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': 'SHIFT#',
        ':date': date,
        ':true': true,
        ':callerId': callerId,
        ':published': 'published',
      },
    }),
  );
  return (result.Items ?? []) as ShiftRecord[];
}
