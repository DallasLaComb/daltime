import { randomUUID } from 'node:crypto';
import type {
  NotificationRecord,
  NotificationResponse,
  NotificationType,
} from '@daltime/contracts';
import { stripKeys } from '../dynamo.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { logger } from '../logger.js';
import * as db from './db.js';

/**
 * Create a notification for a recipient. Synchronous, in-process — called inline
 * by other backend slices that need to notify a user (e.g. an approval handler).
 * No HTTP route exposes this directly.
 */
export async function createNotification(
  recipientSub: string,
  type: NotificationType,
  message: string,
): Promise<NotificationResponse> {
  if (!recipientSub) throw new ValidationError('recipientSub is required');
  if (!message || !message.trim()) throw new ValidationError('message is required');

  const rawId = randomUUID();
  const created_at = new Date().toISOString();
  const notification_id = `${created_at}#${rawId}`;

  const record: NotificationRecord = {
    PK: `USER#${recipientSub}`,
    SK: `NOTIFICATION#${notification_id}`,
    notification_id,
    recipient_sub: recipientSub,
    type,
    message: message.trim(),
    read: false,
    created_at,
  };

  await db.putNotification(record);
  logger.info('notification created', { notification_id, recipient_sub: recipientSub, type });
  return stripKeys(record);
}

/** List the caller's own notifications, newest first. */
export async function listNotifications(callerSub: string): Promise<NotificationResponse[]> {
  const items = await db.queryNotificationsByUser(callerSub);
  return items.map(stripKeys);
}

/**
 * Decode a public composite notification_id (`<created_at>#<rawId>`) into the
 * DynamoDB SK (`NOTIFICATION#<created_at>#<rawId>`).
 */
function toSortKey(notificationId: string): string {
  return `NOTIFICATION#${notificationId}`;
}

/**
 * Mark a single notification as read. Scoped to the caller's own partition —
 * a forged/foreign notificationId simply yields no item, so this throws
 * NotFoundError rather than ForbiddenError to avoid existence leakage.
 */
export async function markOneAsRead(
  callerSub: string,
  notificationId: string,
): Promise<NotificationResponse> {
  if (!notificationId) throw new ValidationError('notificationId is required');

  const sk = toSortKey(notificationId);
  const existing = await db.getNotification(callerSub, sk);
  if (!existing) {
    throw new NotFoundError(`Notification '${notificationId}' not found`);
  }

  if (!existing.read) {
    await db.updateNotificationRead(callerSub, sk);
  }

  logger.info('notification read', { caller_sub: callerSub, notification_id: notificationId, already_read: existing.read });
  return stripKeys({ ...existing, read: true });
}

/** Mark all of the caller's unread notifications as read. Returns the count marked. */
export async function markAllAsRead(callerSub: string): Promise<number> {
  const unread = await db.queryUnreadNotificationsByUser(callerSub);
  await Promise.all(unread.map((item) => db.updateNotificationRead(callerSub, item.SK)));
  logger.info('notifications all read', { caller_sub: callerSub, items_marked: unread.length });
  return unread.length;
}
