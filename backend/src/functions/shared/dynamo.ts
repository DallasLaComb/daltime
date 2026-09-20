import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Employee } from './models/org-admin/employee.model.js';
import type { Location } from './models/manager/location.model.js';
import type { Organization } from './models/web-admin/organization.model.js';

/** Shared DynamoDB Document Client — initialised once per Lambda cold start. */
const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client);

/** Single table name injected via environment variable. */
export const TABLE_NAME = process.env.TABLE_NAME!;

/** GSI1 index name used for listing entities by type. */
export const GSI1_INDEX = 'GSI1';

/** Single-table key fields that should not be exposed to API consumers. */
const KEY_FIELDS = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;

/** Strip single-table key attributes from a DynamoDB item before returning it. */
export function stripKeys<T>(item: T): Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {
  const cleaned = { ...item } as Record<string, unknown>;
  for (const key of KEY_FIELDS) delete cleaned[key];
  return cleaned as Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;
}

interface BuildEmployeeParams {
  employeeSub: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  org_id: string;
  manager_id: string;
}

/**
 * Construct a new Employee DynamoDB record from Cognito registration data.
 * The `manager_id` field is passed explicitly — callers supply it from either
 * the request body (org-admin) or the caller's own manager_id (manager role).
 */
export function buildEmployeeRecord({
  employeeSub,
  email,
  first_name,
  last_name,
  phone,
  org_id,
  manager_id,
}: BuildEmployeeParams): Employee {
  const now = new Date().toISOString();
  return {
    PK: `ORG#${org_id}`,
    SK: `EMPLOYEE#${employeeSub}`,
    GSI1PK: 'EMPLOYEE',
    GSI1SK: now,
    employee_id: employeeSub,
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    email: email.trim(),
    phone: phone?.trim() ?? '',
    org_id,
    manager_id,
    status: 'FORCE_CHANGE_PASSWORD',
    created_at: now,
    updated_at: now,
  };
}

/** Fetch the USER#{userId} / METADATA reverse-lookup record and cast to the expected shape. */
export async function getMetadataRecord<T extends Record<string, unknown>>(
  userId: string,
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: 'METADATA' } }),
  );
  if (!result.Item) return null;
  return result.Item as T;
}

/**
 * Build a DynamoDB SET UpdateExpression from a plain object.
 * Keys with `undefined` values are skipped. Each field name is aliased as `#field` / `:field`.
 */
export function buildUpdateExpression(fields: Record<string, unknown>): {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const parts: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    parts.push(`#${field} = :${field}`);
  }

  return {
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/**
 * Write both the primary employee record (with GSI fields) and the reverse-lookup USER# METADATA
 * record in parallel. Used by all roles that create employees.
 */
export async function createEmployeeRecord(employee: Employee): Promise<void> {
  const primary: Employee = { ...employee, GSI1PK: 'EMPLOYEE', GSI1SK: employee.created_at };
  const reverseLookup = {
    PK: `USER#${employee.employee_id}`,
    SK: 'METADATA',
    employee_id: employee.employee_id,
    email: employee.email,
    first_name: employee.first_name,
    last_name: employee.last_name,
    org_id: employee.org_id,
    status: employee.status,
    created_at: employee.created_at,
  };
  await Promise.all([
    docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: primary })),
    docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: reverseLookup })),
  ]);
}

/**
 * Update mutable name/phone fields on a primary ORG# record and the corresponding USER# METADATA
 * reverse-lookup record in sequence. Returns the updated primary record attributes.
 */
export async function updateOrgAndMetadataRecord<T>(
  primaryKey: { PK: string; SK: string },
  userId: string,
  fields: { first_name?: string; last_name?: string; phone?: string; [key: string]: unknown },
  updatedAt: string,
): Promise<T | null> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: primaryKey,
      ...buildUpdateExpression({ updated_at: updatedAt, ...fields }),
      ReturnValues: 'ALL_NEW',
    }),
  );

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      ...buildUpdateExpression({
        updated_at: updatedAt,
        first_name: fields.first_name,
        last_name: fields.last_name,
      }),
    }),
  );

  return (result.Attributes as T) ?? null;
}

/**
 * Update `status` (and `updated_at`) on a primary record and the corresponding USER# METADATA
 * reverse-lookup record in parallel.
 */
export async function setEntityStatus(
  primaryKey: { PK: string; SK: string },
  userId: string,
  status: string,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: primaryKey,
        UpdateExpression: 'SET #status = :status, #updated_at = :now',
        ExpressionAttributeNames: { '#status': 'status', '#updated_at': 'updated_at' },
        ExpressionAttributeValues: { ':status': status, ':now': now },
      }),
    ),
    docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
      }),
    ),
  ]);
}

/**
 * Update `name`, `address`, and `updated_at` on an ORG# METADATA record.
 * Used by both org-admin and web-admin to update organization details.
 */
export async function updateOrganizationRecord(
  orgId: string,
  fields: { name: string; address: string; updated_at: string },
): Promise<Organization> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #name = :name, address = :address, updated_at = :updated_at',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':name': fields.name,
        ':address': fields.address,
        ':updated_at': fields.updated_at,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as Organization;
}

/**
 * List all locations for a given org by querying PK = ORG#<orgId>, SK begins_with LOCATION#.
 * Used by both manager and org-admin roles.
 */
export async function listOrgLocations(orgId: string): Promise<Location[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':prefix': 'LOCATION#',
      },
    }),
  );
  return (result.Items ?? []) as Location[];
}

/**
 * Get a single location by org + locationId.
 * Used by both manager and org-admin roles.
 */
export async function getOrgLocation(orgId: string, locationId: string): Promise<Location | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `LOCATION#${locationId}` },
    }),
  );
  return (result.Item as Location) ?? null;
}

/**
 * Fetch a single record from the org partition by its SK prefix and entity ID.
 * e.g. getOrgEntityRecord<Employee>(orgId, 'EMPLOYEE', employeeId)
 */
export async function getOrgEntityRecord<T>(
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `${entityType}#${entityId}` },
    }),
  );
  return (result.Item as T) ?? null;
}
