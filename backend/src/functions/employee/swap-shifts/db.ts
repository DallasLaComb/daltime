import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, GSI1_INDEX, getMetadataRecord } from '../../shared/dynamo.js';
import type { EmployeeRecord, ShiftRecord, SwapShiftRecord } from '@daltime/contracts';

/**
 * Fetch the USER#<userId>/METADATA reverse-lookup record to resolve the
 * caller's org_id and employee_id. Returns null if not found (caller not
 * provisioned), which the service layer treats as a 403.
 */
export async function getCallerLookup(userId: string): Promise<{
  org_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  manager_id: string;
} | null> {
  return getMetadataRecord<{
    org_id: string;
    employee_id: string;
    first_name: string;
    last_name: string;
    manager_id: string;
  }>(userId);
}

/**
 * Fetch a single SHIFT# record from the org partition by shift_id.
 * Used to validate that the shift belongs to the caller and is published
 * before allowing a swap post.
 */
export async function getShiftById(orgId: string, shiftId: string): Promise<ShiftRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SHIFT#${shiftId}` },
    }),
  );
  return (result.Item as ShiftRecord) ?? null;
}

/**
 * Fetch a single SWAP# record by org and swapId.
 * Org-scoped via PK so a caller from a different org always gets null (404, not 403),
 * avoiding leaking the existence of swap listings from other orgs.
 */
export async function getSwapById(orgId: string, swapId: string): Promise<SwapShiftRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SWAP#${swapId}` },
    }),
  );
  return (result.Item as SwapShiftRecord) ?? null;
}

/**
 * Check whether an open SWAP# record already exists for a given shift and
 * poster. Used for the duplicate-post guard before creating a new listing.
 * Returns the first matching item, or null if no open duplicate exists.
 */
export async function findOpenSwapForShift(
  orgId: string,
  shiftId: string,
  employeeId: string,
): Promise<SwapShiftRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      FilterExpression: 'shift_id = :shiftId AND posted_by_employee_id = :employeeId',
      ExpressionAttributeValues: {
        ':gsi1pk': `ORG_SWAP#${orgId}`,
        ':prefix': 'STATUS#open#',
        ':shiftId': shiftId,
        ':employeeId': employeeId,
      },
      Limit: 1,
    }),
  );
  const items = result.Items ?? [];
  return items.length > 0 ? (items[0] as SwapShiftRecord) : null;
}

/**
 * List all open swap listings for an org via GSI1, excluding the caller's own
 * listings (those belong in the "My Posted Shifts" panel instead).
 * Returns newest first (ScanIndexForward: false) so the UI shows recent listings
 * at the top without requiring client-side sorting.
 */
export async function listOpenSwapsForOrg(
  orgId: string,
  excludeEmployeeId: string,
): Promise<SwapShiftRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      FilterExpression: 'posted_by_employee_id <> :callerId',
      ExpressionAttributeValues: {
        ':gsi1pk': `ORG_SWAP#${orgId}`,
        ':prefix': 'STATUS#open#',
        ':callerId': excludeEmployeeId,
      },
      ScanIndexForward: false,
    }),
  );
  return (result.Items ?? []) as SwapShiftRecord[];
}

/**
 * List all SWAP# records posted by a specific employee, regardless of status.
 * Uses the primary table with begins_with(SK, 'SWAP#') scoped to the org
 * partition, then filters by posted_by_employee_id. This avoids a delete/GSI
 * approach and shows full history (open + claimed + cancelled) for the employee.
 */
export async function listMyPostedSwaps(
  orgId: string,
  employeeId: string,
): Promise<SwapShiftRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'posted_by_employee_id = :employeeId',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': 'SWAP#',
        ':employeeId': employeeId,
      },
    }),
  );
  return (result.Items ?? []) as SwapShiftRecord[];
}

/**
 * Write a new SWAP# item to DynamoDB. This is a plain PutItem — the caller
 * (service.ts) has already verified no open duplicate exists via findOpenSwapForShift
 * before calling this function.
 */
export async function putSwap(swap: SwapShiftRecord): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: swap }));
}

/**
 * Update a swap listing's status to 'cancelled' and flip the GSI1SK prefix
 * from STATUS#open# to STATUS#cancelled# so the listing disappears from the
 * "Available to Take" GSI query automatically without a delete.
 */
export async function cancelSwap(orgId: string, swapId: string, createdAt: string): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SWAP#${swapId}` },
      UpdateExpression: 'SET #status = :status, GSI1SK = :gsi1sk, updated_at = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'cancelled',
        ':gsi1sk': `STATUS#cancelled#${createdAt}`,
        ':now': now,
      },
    }),
  );
}

/**
 * Update a swap listing's status to 'claimed', record who claimed it, and
 * flip GSI1SK from STATUS#open# to STATUS#claimed# so it disappears from the
 * "Available to Take" query automatically. Also updates the SHIFT# record to
 * transfer ownership to the claimer — both writes happen in a Promise.all since
 * they are independent and have no atomicity requirement for notification purposes.
 *
 * The SWAP# UpdateCommand includes a ConditionExpression that checks the current
 * status is still 'open' at the moment of the write. This makes the claim atomic:
 * if two concurrent callers both read status='open' and both attempt to claim,
 * exactly one will win and the other will receive a ConditionalCheckFailedException.
 * The caller (service.claimSwapShift) catches that exception and throws ConflictError
 * (→ 409) so the losing claimer gets a clear "already claimed" response rather than
 * silently overwriting the first claimer's data.
 */
export async function claimSwapAndTransferShift(
  orgId: string,
  swapId: string,
  shiftId: string,
  createdAt: string,
  claimer: { employee_id: string; employee_name: string },
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    // Mark the SWAP# record as claimed and record who claimed it.
    // ConditionExpression ensures only one concurrent claimer can win — if
    // status has already been changed to 'claimed' or 'cancelled' by another
    // request, DynamoDB throws ConditionalCheckFailedException before writing.
    docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ORG#${orgId}`, SK: `SWAP#${swapId}` },
        UpdateExpression:
          'SET #status = :status, GSI1SK = :gsi1sk, claimed_by_employee_id = :claimerId, claimed_by_employee_name = :claimerName, updated_at = :now',
        ConditionExpression: '#status = :open',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'claimed',
          ':gsi1sk': `STATUS#claimed#${createdAt}`,
          ':claimerId': claimer.employee_id,
          ':claimerName': claimer.employee_name,
          ':now': now,
          ':open': 'open',
        },
      }),
    ),
    // Transfer the SHIFT# record to the claimer — update employee_id and employee_name.
    docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ORG#${orgId}`, SK: `SHIFT#${shiftId}` },
        UpdateExpression: 'SET employee_id = :empId, employee_name = :empName, updated_at = :now',
        ExpressionAttributeValues: {
          ':empId': claimer.employee_id,
          ':empName': claimer.employee_name,
          ':now': now,
        },
      }),
    ),
  ]);
}

/**
 * Fetch a full employee record from the org partition by employee_id.
 * Used when the service needs to read the manager_id from the posting employee's
 * record at swap-post time (manager_id is not in the METADATA reverse-lookup).
 */
export async function getEmployeeByIdInOrg(
  orgId: string,
  employeeId: string,
): Promise<EmployeeRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `EMPLOYEE#${employeeId}` },
    }),
  );
  return (result.Item as EmployeeRecord) ?? null;
}
