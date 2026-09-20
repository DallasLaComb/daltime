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
 * Base query builder shared by all three time-window variants. Queries
 * PK = ORG#<orgId>, SK begins_with SHIFT# and enforces that only published
 * shifts belonging to this employee are returned. The caller supplies the
 * additional FilterExpression fragment and its attribute values to apply the
 * desired time window.
 *
 * Kept private — callers use the three public functions below.
 */
async function queryShiftsByEmployee(
  orgId: string,
  employeeId: string,
  dateFilter: string,
  dateFilterValues: Record<string, string>,
): Promise<ShiftRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: `employee_id = :employeeId AND ${dateFilter} AND (#status = :published OR attribute_not_exists(#status))`,
      ExpressionAttributeNames: { '#date': 'date', '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':skPrefix': 'SHIFT#',
        ':employeeId': employeeId,
        ':published': 'published',
        ...dateFilterValues,
      },
    }),
  );
  return (result.Items ?? []) as ShiftRecord[];
}

/**
 * List shifts for an employee filtered to a single calendar month.
 * Uses begins_with(#date, :month) so the YYYY-MM prefix matches all days in
 * that month without requiring a range query.
 */
export async function listShiftsByEmployeeMonth(
  orgId: string,
  employeeId: string,
  month: string,
): Promise<ShiftRecord[]> {
  return queryShiftsByEmployee(orgId, employeeId, 'begins_with(#date, :month)', {
    ':month': month,
  });
}

/**
 * List shifts for an employee on a specific calendar day.
 * Uses an equality filter on #date = :date (YYYY-MM-DD ISO string comparison).
 */
export async function listShiftsByEmployeeDate(
  orgId: string,
  employeeId: string,
  date: string,
): Promise<ShiftRecord[]> {
  return queryShiftsByEmployee(orgId, employeeId, '#date = :date', { ':date': date });
}

/**
 * List shifts for an employee within a 7-day window (inclusive).
 * Uses a range filter: #date >= :weekStart AND #date <= :weekEnd.
 * YYYY-MM-DD lexicographic ordering is identical to chronological ordering,
 * so no GSI is needed for this range.
 */
export async function listShiftsByEmployeeWeek(
  orgId: string,
  employeeId: string,
  weekStart: string,
  weekEnd: string,
): Promise<ShiftRecord[]> {
  return queryShiftsByEmployee(orgId, employeeId, '#date >= :weekStart AND #date <= :weekEnd', {
    ':weekStart': weekStart,
    ':weekEnd': weekEnd,
  });
}
