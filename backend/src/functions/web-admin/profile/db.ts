/**
 * DynamoDB access layer for the web-admin profile feature.
 *
 * Two operations — a point-lookup GET and a partial-update PUT — both scoped
 * to the caller's own `USER#<sub> / METADATA` record. No GSI, no org_id, no
 * fan-out: WebAdmin metadata is stored in a single base-table item.
 *
 * Both helpers receive `sub` from the verified JWT (extracted by
 * `requireWebAdminWithLookup`) so there is no cross-caller lookup risk.
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  docClient,
  TABLE_NAME,
  getMetadataRecord,
  buildUpdateExpression,
} from '../../shared/dynamo.js';
import type { WebAdminMetadata } from '../../shared/models/web-admin/web-admin.model.js';

/**
 * Fetch the caller's own WebAdmin metadata record from DynamoDB.
 *
 * Uses a base-table GetItem on PK = USER#<sub>, SK = METADATA via the shared
 * `getMetadataRecord` helper — the cheapest possible read (1 RCU, no index).
 * Returns `null` if the record does not exist (should not happen after
 * `requireWebAdminWithLookup` succeeds, but callers should handle it anyway).
 */
export async function getWebAdminProfile(sub: string): Promise<WebAdminMetadata | null> {
  // `getMetadataRecord` constrains T to an index-signature shape that interfaces like
  // `WebAdminMetadata` don't satisfy; the Item is cast to T inside the helper anyway,
  // so bridge through `unknown` here (same pattern as `web-admin/shared/db.ts`).
  return getMetadataRecord<Record<string, unknown>>(sub) as Promise<WebAdminMetadata | null>;
}

/**
 * Partially update mutable fields on the caller's own WebAdmin metadata record.
 *
 * Uses `buildUpdateExpression` to skip any fields not provided by the caller
 * (partial-update semantics), then calls `UpdateCommand` with `ReturnValues:
 * 'ALL_NEW'` so the handler can return the refreshed item without a second GET.
 *
 * `updatedAt` is always written — it is injected by the service layer so that
 * unit tests can assert the exact timestamp without depending on `new Date()`.
 *
 * Does NOT use a `ConditionExpression` on `attribute_exists(PK)` — the record
 * is guaranteed to exist because `requireWebAdminWithLookup` performs a GET
 * on the same PK before any mutation is allowed (fail-closed: missing record
 * is already rejected at the auth layer with a 403).
 */
export async function updateWebAdminProfile(
  sub: string,
  fields: { first_name?: string; last_name?: string },
  updatedAt: string,
): Promise<WebAdminMetadata | null> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${sub}`, SK: 'METADATA' },
      ...buildUpdateExpression({ updated_at: updatedAt, ...fields }),
      ReturnValues: 'ALL_NEW',
    }),
  );
  return (result.Attributes as WebAdminMetadata) ?? null;
}
