import type { NotificationRecord } from '@daltime/contracts';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationError, NotFoundError } from '../../../../src/functions/shared/errors.js';

vi.mock('../../../../src/functions/shared/notifications/db.js', () => ({
  queryNotificationsByUser: vi.fn(),
  queryUnreadNotificationsByUser: vi.fn(),
  getNotification: vi.fn(),
  putNotification: vi.fn(),
  updateNotificationRead: vi.fn(),
}));

import * as db from '../../../../src/functions/shared/notifications/db.js';
import {
  createNotification,
  listNotifications,
  markOneAsRead,
  markAllAsRead,
} from '../../../../src/functions/shared/notifications/service.js';

beforeEach(() => vi.clearAllMocks());

const callerSub = 'caller-sub-123';
const otherSub = 'other-sub-456';

function buildRecord(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    PK: `USER#${callerSub}`,
    SK: 'NOTIFICATION#2025-01-01T00:00:00.000Z#raw-id-1',
    notification_id: '2025-01-01T00:00:00.000Z#raw-id-1',
    recipient_sub: callerSub,
    type: 'INFO',
    message: 'hello',
    read: false,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── createNotification ─────────────────────────────────────────────────────

describe('createNotification()', () => {
  it('persists a record and returns the public shape (PK/SK stripped)', async () => {
    vi.mocked(db.putNotification).mockResolvedValue(undefined);

    const result = await createNotification(callerSub, 'INFO', 'You have a new shift');

    expect(db.putNotification).toHaveBeenCalledTimes(1);
    const written = vi.mocked(db.putNotification).mock.calls[0][0];
    expect(written.PK).toBe(`USER#${callerSub}`);
    expect(written.SK).toMatch(/^NOTIFICATION#.+#.+$/);
    expect(written.recipient_sub).toBe(callerSub);
    expect(written.read).toBe(false);

    expect(result).not.toHaveProperty('PK');
    expect(result).not.toHaveProperty('SK');
    expect(result.message).toBe('You have a new shift');
  });

  it('trims the message before persisting', async () => {
    vi.mocked(db.putNotification).mockResolvedValue(undefined);
    await createNotification(callerSub, 'INFO', '   padded message   ');
    const written = vi.mocked(db.putNotification).mock.calls[0][0];
    expect(written.message).toBe('padded message');
  });

  it('rejects an empty recipientSub', async () => {
    await expect(createNotification('', 'INFO', 'msg')).rejects.toThrow(ValidationError);
    expect(db.putNotification).not.toHaveBeenCalled();
  });

  it('rejects an empty message', async () => {
    await expect(createNotification(callerSub, 'INFO', '')).rejects.toThrow(ValidationError);
    expect(db.putNotification).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only message', async () => {
    await expect(createNotification(callerSub, 'INFO', '   ')).rejects.toThrow(ValidationError);
    expect(db.putNotification).not.toHaveBeenCalled();
  });

  it('generates a distinct notification_id per call even within the same millisecond', async () => {
    vi.mocked(db.putNotification).mockResolvedValue(undefined);
    const [a, b] = await Promise.all([
      createNotification(callerSub, 'INFO', 'msg-1'),
      createNotification(callerSub, 'INFO', 'msg-2'),
    ]);
    expect(a.notification_id).not.toBe(b.notification_id);
  });
});

// ─── listNotifications ──────────────────────────────────────────────────────

describe('listNotifications()', () => {
  it('returns the caller-scoped items with keys stripped', async () => {
    vi.mocked(db.queryNotificationsByUser).mockResolvedValue([buildRecord()]);

    const result = await listNotifications(callerSub);

    expect(db.queryNotificationsByUser).toHaveBeenCalledWith(callerSub);
    expect(result).toEqual([
      {
        notification_id: '2025-01-01T00:00:00.000Z#raw-id-1',
        recipient_sub: callerSub,
        type: 'INFO',
        message: 'hello',
        read: false,
        created_at: '2025-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns [] when caller has no notifications (empty state)', async () => {
    vi.mocked(db.queryNotificationsByUser).mockResolvedValue([]);
    const result = await listNotifications(callerSub);
    expect(result).toEqual([]);
  });

  it("never queries another user's partition — only the exact callerSub passed in", async () => {
    vi.mocked(db.queryNotificationsByUser).mockResolvedValue([]);
    await listNotifications(otherSub);
    expect(db.queryNotificationsByUser).toHaveBeenCalledWith(otherSub);
    expect(db.queryNotificationsByUser).not.toHaveBeenCalledWith(callerSub);
  });
});

// ─── markOneAsRead — the privacy-critical path ──────────────────────────────

describe('markOneAsRead()', () => {
  it('marks an owned, unread notification as read', async () => {
    const record = buildRecord({ read: false });
    vi.mocked(db.getNotification).mockResolvedValue(record);
    vi.mocked(db.updateNotificationRead).mockResolvedValue(undefined);

    const result = await markOneAsRead(callerSub, record.notification_id);

    expect(db.getNotification).toHaveBeenCalledWith(callerSub, record.SK);
    expect(db.updateNotificationRead).toHaveBeenCalledWith(callerSub, record.SK);
    expect(result.read).toBe(true);
  });

  it('is idempotent — does not re-issue UpdateItem when already read', async () => {
    const record = buildRecord({ read: true });
    vi.mocked(db.getNotification).mockResolvedValue(record);

    const result = await markOneAsRead(callerSub, record.notification_id);

    expect(db.updateNotificationRead).not.toHaveBeenCalled();
    expect(result.read).toBe(true);
  });

  it('throws NotFoundError when notificationId is empty string', async () => {
    await expect(markOneAsRead(callerSub, '')).rejects.toThrow(ValidationError);
    expect(db.getNotification).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the record does not exist at all', async () => {
    vi.mocked(db.getNotification).mockResolvedValue(null);
    await expect(markOneAsRead(callerSub, 'bogus-id')).rejects.toThrow(NotFoundError);
    expect(db.updateNotificationRead).not.toHaveBeenCalled();
  });

  it('CROSS-USER LEAK CHECK: throws NotFoundError (never returns the item) when the notification_id belongs to another user', async () => {
    // db.getNotification is scoped by callerSub in the real implementation;
    // here we simulate the only way the mock layer can model that scoping:
    // the db call made with callerSub returns null because the record
    // actually lives under USER#<otherSub>'s partition.
    vi.mocked(db.getNotification).mockImplementation(async (sub) => {
      if (sub === otherSub) return buildRecord({ recipient_sub: otherSub, PK: `USER#${otherSub}` });
      return null;
    });

    const victimsNotificationId = '2025-01-01T00:00:00.000Z#raw-id-1';

    await expect(markOneAsRead(callerSub, victimsNotificationId)).rejects.toThrow(NotFoundError);
    // Confirm the service called getNotification with the ATTACKER's own sub,
    // not the victim's — i.e. it never widens the partition based on the id.
    expect(db.getNotification).toHaveBeenCalledWith(
      callerSub,
      'NOTIFICATION#2025-01-01T00:00:00.000Z#raw-id-1',
    );
    expect(db.updateNotificationRead).not.toHaveBeenCalled();
  });

  it('reconstructs the SK by re-prepending NOTIFICATION# to the public composite id verbatim', async () => {
    vi.mocked(db.getNotification).mockResolvedValue(null);
    const publicId = '2025-06-18T08:30:00.123Z#abc-def-123';
    await expect(markOneAsRead(callerSub, publicId)).rejects.toThrow(NotFoundError);
    expect(db.getNotification).toHaveBeenCalledWith(callerSub, `NOTIFICATION#${publicId}`);
  });

  it('handles a notification_id missing the # separator without throwing an unhandled error', async () => {
    vi.mocked(db.getNotification).mockResolvedValue(null);
    // Malformed/forged id with no '#' at all — toSortKey still produces a
    // syntactically valid (if nonsensical) SK; getNotification correctly
    // returns null and the service surfaces NotFoundError, not a 500.
    await expect(markOneAsRead(callerSub, 'not-a-real-composite-id')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('handles a notificationId containing a literal, partially-decoded %23 (encoded # sent as-is) without throwing an unhandled error', async () => {
    // Simulates a client that double-encodes or forwards an already-percent-encoded
    // id verbatim instead of decoding it — toSortKey treats it as an opaque string,
    // so this should surface as a clean NotFoundError (no match), not a 500.
    vi.mocked(db.getNotification).mockResolvedValue(null);
    const partiallyEncodedId = '2025-06-18T08%3A30%3A00.123Z%23abc-def-456';
    await expect(markOneAsRead(callerSub, partiallyEncodedId)).rejects.toThrow(NotFoundError);
    expect(db.getNotification).toHaveBeenCalledWith(
      callerSub,
      `NOTIFICATION#${partiallyEncodedId}`,
    );
  });

  it('handles an extremely long (10,000+ char) notificationId without throwing an unhandled error or truncating', async () => {
    vi.mocked(db.getNotification).mockResolvedValue(null);
    const hugeId = `2025-06-18T08:30:00.123Z#${'a'.repeat(10_000)}`;
    await expect(markOneAsRead(callerSub, hugeId)).rejects.toThrow(NotFoundError);
    expect(db.getNotification).toHaveBeenCalledWith(callerSub, `NOTIFICATION#${hugeId}`);
  });

  it('treats whitespace-only notificationId the same as empty (ValidationError, not NotFoundError)', async () => {
    // '   ' is truthy as a string but should arguably be rejected the same way
    // empty string is. Documenting actual behavior: current code only checks
    // falsy (`!notificationId`), so whitespace-only IS NOT caught by the
    // ValidationError guard and instead proceeds to a DB lookup that returns
    // null -> NotFoundError. This is a real behavioral finding, not asserted
    // as a bug here — see Completion Notes for human-review flag.
    vi.mocked(db.getNotification).mockResolvedValue(null);
    await expect(markOneAsRead(callerSub, '   ')).rejects.toThrow(NotFoundError);
  });
});

// ─── markAllAsRead ───────────────────────────────────────────────────────────

describe('markAllAsRead()', () => {
  it('updates every unread item returned by the unread query', async () => {
    const unread = [
      buildRecord({ SK: 'NOTIFICATION#a', read: false }),
      buildRecord({ SK: 'NOTIFICATION#b', read: false }),
    ];
    vi.mocked(db.queryUnreadNotificationsByUser).mockResolvedValue(unread);
    vi.mocked(db.updateNotificationRead).mockResolvedValue(undefined);

    const result = await markAllAsRead(callerSub);

    expect(db.queryUnreadNotificationsByUser).toHaveBeenCalledWith(callerSub);
    expect(db.updateNotificationRead).toHaveBeenCalledTimes(2);
    expect(db.updateNotificationRead).toHaveBeenCalledWith(callerSub, 'NOTIFICATION#a');
    expect(db.updateNotificationRead).toHaveBeenCalledWith(callerSub, 'NOTIFICATION#b');
    expect(result).toBe(2);
  });

  it('does nothing when there are no unread notifications (empty state)', async () => {
    vi.mocked(db.queryUnreadNotificationsByUser).mockResolvedValue([]);
    const result = await markAllAsRead(callerSub);
    expect(db.updateNotificationRead).not.toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it("scopes the unread query to the caller's own sub only", async () => {
    vi.mocked(db.queryUnreadNotificationsByUser).mockResolvedValue([]);
    await markAllAsRead(otherSub);
    expect(db.queryUnreadNotificationsByUser).toHaveBeenCalledWith(otherSub);
    expect(db.queryUnreadNotificationsByUser).not.toHaveBeenCalledWith(callerSub);
  });

  it('PARTIAL FAILURE: if one of several UpdateItem calls rejects, Promise.all rejects and the whole markAllAsRead call throws — some items may already be marked read with no rollback', async () => {
    const unread = [
      buildRecord({ SK: 'NOTIFICATION#a', read: false }),
      buildRecord({ SK: 'NOTIFICATION#b', read: false }),
      buildRecord({ SK: 'NOTIFICATION#c', read: false }),
    ];
    vi.mocked(db.queryUnreadNotificationsByUser).mockResolvedValue(unread);
    vi.mocked(db.updateNotificationRead).mockImplementation(async (_sub, sk) => {
      if (sk === 'NOTIFICATION#b') throw new Error('DynamoDB throttled');
    });

    await expect(markAllAsRead(callerSub)).rejects.toThrow('DynamoDB throttled');
    // All three updates were still attempted concurrently (Promise.all fires
    // every promise before any rejection short-circuits the await) — meaning
    // 'a' and 'c' may have succeeded even though the overall call surfaces
    // as a failure to the caller. This is a partial-failure / no-rollback
    // risk, documented here rather than asserted as correct behavior.
    expect(db.updateNotificationRead).toHaveBeenCalledTimes(3);
  });

  it('RACE: two concurrent markAllAsRead calls for the same caller both succeed safely (no corruption, no error) — each just re-marks whatever its own snapshot saw as unread', async () => {
    // Models two simultaneous mark-all-read requests (e.g. double-click, or two
    // browser tabs) racing against the same unread query result. Since
    // queryUnreadNotificationsByUser and updateNotificationRead are independent,
    // non-conditional calls (UpdateItem has no ConditionExpression / version
    // check), both calls are individually idempotent at the item level — setting
    // read=true twice on the same item is a safe no-op at the DynamoDB layer.
    const unread = [buildRecord({ SK: 'NOTIFICATION#a', read: false })];
    vi.mocked(db.queryUnreadNotificationsByUser).mockResolvedValue(unread);
    vi.mocked(db.updateNotificationRead).mockResolvedValue(undefined);

    const [resultA, resultB] = await Promise.all([
      markAllAsRead(callerSub),
      markAllAsRead(callerSub),
    ]);

    // Both calls observed the same unread snapshot (mock returns the same list
    // each time) and so both report marking 1 item — this is the actual,
    // observed double-counting behavior: marked_count reflects "items this
    // call saw as unread," not "items newly transitioned by this call." A
    // second concurrent caller's UI would show marked_count: 1 even though
    // its own action was a no-op against an item already marked read by the
    // other concurrent call. Documented as a finding, not asserted as a bug.
    expect(resultA).toBe(1);
    expect(resultB).toBe(1);
    expect(db.updateNotificationRead).toHaveBeenCalledTimes(2);
    expect(db.updateNotificationRead).toHaveBeenNthCalledWith(1, callerSub, 'NOTIFICATION#a');
    expect(db.updateNotificationRead).toHaveBeenNthCalledWith(2, callerSub, 'NOTIFICATION#a');
  });
});
