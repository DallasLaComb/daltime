import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/** Category of a notification, used by the UI to pick an icon and styling. */
export const NotificationType = z
  .enum(['INFO', 'APPROVAL', 'REQUEST', 'SHIFT'])
  .meta({ id: 'NotificationType', description: 'Category of a notification.' });

/**
 * Notification record stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/notifications/notification.model.ts`.
 *
 *   PK = USER#<recipient_sub>
 *   SK = NOTIFICATION#<created_at>#<raw_id>
 *
 * Listing a user's notifications is a base-table query with SK descending, so
 * newest-first ordering falls out of the sort key without a GSI.
 */
export const NotificationRecord = SingleTableKeys.extend({
  notification_id: z.string().meta({
    description: 'Public composite id — `${created_at}#${raw_id}`, mirroring the SK suffix.',
  }),
  recipient_sub: z.string(),
  type: NotificationType,
  message: z.string(),
  read: z.boolean(),
  created_at: IsoTimestamp,
});

export const NotificationApiFields = apiShapeOf(NotificationRecord);

export type NotificationType = z.infer<typeof NotificationType>;
export type NotificationRecord = z.infer<typeof NotificationRecord>;
export type NotificationApiFields = z.infer<typeof NotificationApiFields>;
