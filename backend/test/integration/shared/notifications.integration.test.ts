import type { NotificationRecord } from '@daltime/contracts';
/**
 * Integration test for the notifications vertical slice (issue #209).
 *
 * IMPORTANT — testability gap, documented per Tester Agent conventions:
 * This repo has no DynamoDB Local / LocalStack harness wired into
 * `vitest run --project integration` (confirmed: `test/integration/` contains
 * only a placeholder, and `backend/package.json`'s only local-DynamoDB path is
 * `sam local start-api`, which requires AWS credentials profile `daltime-dev`
 * and is not scriptable from vitest in CI). A genuine end-to-end test against
 * a real or LocalStack-backed table is NOT POSSIBLE today without adding that
 * infra — flagged here explicitly rather than silently skipped, see report.
 *
 * What this test DOES do, to get as close to a real integration boundary as
 * possible without new infra: it exercises the actual `db.ts` -> `service.ts`
 * call chain through the real `docClient.send()` method (not a `vi.mock` of
 * service.ts/db.ts), backed by an in-memory fake DynamoDB that enforces real
 * key semantics (exact PK/SK match for GetItem, PK match + begins_with(SK)
 * for Query, FilterExpression on `read`). This is the most faithful proof
 * available that the cross-user partition isolation described in the
 * blueprint actually holds at the DynamoDB key-shape level, not just because
 * a mock was told to return null.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../src/functions/shared/dynamo.js';
import { NotFoundError } from '../../../src/functions/shared/errors.js';
import {
  createNotification,
  listNotifications,
  markOneAsRead,
  markAllAsRead,
} from '../../../src/functions/shared/notifications/service.js';

const ddbMock = mockClient(docClient as unknown as DynamoDBDocumentClient);

/** In-memory fake table keyed by `${PK}|${SK}`, enforcing real DynamoDB key semantics. */
let fakeTable: Map<string, NotificationRecord>;

function tableKey(pk: string, sk: string): string {
  return `${pk}|${sk}`;
}

beforeEach(() => {
  fakeTable = new Map();
  ddbMock.reset();

  ddbMock.on(PutCommand).callsFake((input) => {
    const item = input.Item as NotificationRecord;
    fakeTable.set(tableKey(item.PK, item.SK), item);
    return {};
  });

  ddbMock.on(GetCommand).callsFake((input) => {
    const { PK, SK } = input.Key as { PK: string; SK: string };
    const item = fakeTable.get(tableKey(PK, SK));
    return { Item: item };
  });

  ddbMock.on(QueryCommand).callsFake((input) => {
    const pk = input.ExpressionAttributeValues?.[':pk'] as string;
    const prefix = input.ExpressionAttributeValues?.[':prefix'] as string;
    const wantUnread = input.ExpressionAttributeValues?.[':unread'];
    let items = [...fakeTable.values()].filter(
      (item) => item.PK === pk && item.SK.startsWith(prefix),
    );
    if (wantUnread !== undefined) {
      items = items.filter((item) => item.read === wantUnread);
    }
    // newest first, mirroring ScanIndexForward: false
    items = items.sort((a, b) => (a.SK < b.SK ? 1 : -1));
    return { Items: items };
  });

  ddbMock.on(UpdateCommand).callsFake((input) => {
    const { PK, SK } = input.Key as { PK: string; SK: string };
    const existing = fakeTable.get(tableKey(PK, SK));
    if (existing) fakeTable.set(tableKey(PK, SK), { ...existing, read: true });
    return {};
  });
});

const userA = 'user-a-sub-aaa';
const userB = 'user-b-sub-bbb';

describe('Notifications — cross-user privacy isolation (issue #209)', () => {
  it("creates a notification for user A, and user B's list is empty", async () => {
    await createNotification(userA, 'APPROVAL', 'Your timesheet was approved');

    const aList = await listNotifications(userA);
    const bList = await listNotifications(userB);

    expect(aList).toHaveLength(1);
    expect(aList[0].message).toBe('Your timesheet was approved');
    expect(bList).toEqual([]);
  });

  it("THE PRIVACY-CRITICAL CASE: user B cannot mark user A's notification as read by forging A's notification_id — service throws NotFoundError, not success", async () => {
    const created = await createNotification(userA, 'APPROVAL', 'Confidential to A');

    // B obtains/forges A's exact public notification_id (e.g. by guessing,
    // intercepting a response, or replaying a captured request) and attempts
    // to mark it read as themselves.
    await expect(markOneAsRead(userB, created.notification_id)).rejects.toThrow(NotFoundError);

    // Assert the underlying record was NOT mutated — A's notification is
    // still unread after B's attempt. This is the airtight check: not just
    // that the service call rejected, but that no write occurred at all.
    const aListAfterAttack = await listNotifications(userA);
    expect(aListAfterAttack).toHaveLength(1);
    expect(aListAfterAttack[0].read).toBe(false);
  });

  it("B's list/markAll calls never see or touch A's notifications even after A has several", async () => {
    await createNotification(userA, 'INFO', 'A notification 1');
    await createNotification(userA, 'SHIFT', 'A notification 2');
    await createNotification(userB, 'INFO', 'B notification 1');

    const bList = await listNotifications(userB);
    expect(bList).toHaveLength(1);
    expect(bList[0].message).toBe('B notification 1');

    // markAllAsRead for B must only touch B's own unread item.
    await markAllAsRead(userB);
    const aListStillUnread = await listNotifications(userA);
    expect(aListStillUnread.every((n) => n.read === false)).toBe(true);

    const bListNowRead = await listNotifications(userB);
    expect(bListNowRead[0].read).toBe(true);
  });

  it('owner CAN mark their own notification as read using the exact public notification_id returned at creation', async () => {
    const created = await createNotification(userA, 'REQUEST', 'Your own notification');
    const result = await markOneAsRead(userA, created.notification_id);
    expect(result.read).toBe(true);

    const list = await listNotifications(userA);
    expect(list[0].read).toBe(true);
  });

  it('markOneAsRead with a well-formed but entirely nonexistent notification_id returns NotFoundError for the owner too', async () => {
    await createNotification(userA, 'INFO', 'unrelated');
    const fakeId = '2099-01-01T00:00:00.000Z#does-not-exist';
    await expect(markOneAsRead(userA, fakeId)).rejects.toThrow(NotFoundError);
  });
});
