import * as z from 'zod';
import { errorResponses } from '../common.js';
import { NotificationApiFields } from '../../entities/notification.js';
import { registerOperation, registerRoleOperation, type DynamoAccess } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/shared/notifications/handler.ts',
  'backend/src/functions/shared/notifications/service.ts',
  'backend/src/functions/shared/notifications/db.ts',
];

/**
 * The four role-prefixed path segments this single Lambda is registered
 * against. One handler serves all of `/web-admin/notifications`,
 * `/org-admin/notifications`, `/manager/notifications`, `/employee/notifications`
 * with identical behaviour — see `backend/src/functions/shared/notifications/handler.ts`.
 * The prefix only scopes *who may call it* (enforced by the JWT authorizer
 * resolving `event.requestContext.authorizer.jwt`, not by anything in this
 * handler itself, which never reads the role segment); it does not change
 * what the handler does. `registerNotificationOperations` below registers one
 * distinct operation per prefix per method so every path the API actually
 * serves appears in the contract, while the request/response schemas
 * themselves are defined exactly once.
 */
const ROLE_PREFIXES = ['web-admin', 'org-admin', 'manager', 'employee'] as const;
type RolePrefix = (typeof ROLE_PREFIXES)[number];

/** PascalCase label per prefix, used to build distinct operationIds (e.g. `listManagerNotifications`). */
const OPERATION_ID_LABEL: Record<RolePrefix, string> = {
  'web-admin': 'WebAdmin',
  'org-admin': 'OrgAdmin',
  manager: 'Manager',
  employee: 'Employee',
};

/**
 * A single notification as returned to its recipient. Derived from the stored
 * entity via `apiShapeOf()` (see `entities/notification.ts`) so the wire shape
 * can never drift from what `stripKeys()` actually strips at runtime.
 */
export const NotificationResponse = NotificationApiFields.meta({
  id: 'NotificationResponse',
  description:
    'A single notification belonging to the caller. `notification_id` is the opaque ' +
    'composite `<created_at>#<rawId>` token — callers must `encodeURIComponent` it before ' +
    'placing it in a URL path segment, since it contains literal `#` and `:` characters.',
});

/** Response for `GET /{role}/notifications` — the caller's notifications, newest first. */
export const NotificationListResponse = z.array(NotificationResponse).meta({
  id: 'NotificationListResponse',
  description:
    "The caller's own notifications only (scoped by `PK = USER#<callerSub>`), sorted newest " +
    'first. Never paginated (out of scope at current scale, see the slice blueprint).',
});

/** Response for `PATCH /{role}/notifications` — mark-all-as-read. */
export const MarkAllNotificationsReadResponse = z
  .object({
    success: z.literal(true),
    marked_count: z
      .int()
      .nonnegative()
      .meta({ description: 'Count of notifications transitioned from unread to read.' }),
  })
  .meta({
    id: 'MarkAllNotificationsReadResponse',
    description: 'Confirms how many of the caller’s unread notifications were marked read.',
  });

/**
 * Path parameters for `PATCH /{role}/notifications/{notificationId}`.
 *
 * Exported so the notifications handler can validate the raw path segment via
 * `parseWithContract` (same pattern as `SwapShiftPathParams`), keeping the
 * documented route shape and the runtime check in one place.
 */
export const MarkOneNotificationPathParams = z.object({
  notificationId: z
    .string()
    .min(1, 'notificationId path parameter is required')
    .meta({
      description:
        'Opaque composite id `<created_at>#<rawId>` returned as `notification_id` on list/create. ' +
        'Must be `encodeURIComponent`-encoded by the caller.',
    }),
});

/** Every DynamoDB access issued by `GET /{role}/notifications` (`listNotifications` in service.ts). */
const LIST_DYNAMODB: DynamoAccess[] = [
  {
    command: 'Query',
    keyCondition: 'PK = USER#<callerSub> AND begins_with(SK, "NOTIFICATION#")',
    note:
      'ScanIndexForward: false. SK embeds `created_at` first, so newest-first ordering falls ' +
      'out of the base-table sort key with no GSI required.',
  },
];

/** Every DynamoDB access issued by `PATCH /{role}/notifications` (`markAllAsRead` in service.ts). */
const MARK_ALL_DYNAMODB: DynamoAccess[] = [
  {
    command: 'Query',
    keyCondition: 'PK = USER#<callerSub> AND begins_with(SK, "NOTIFICATION#")',
    filter: '#read = :unread (i.e. read = false)',
    note: 'ScanIndexForward: false. Finds only the caller’s currently-unread notifications.',
  },
  {
    command: 'Update',
    keyCondition: 'PK = USER#<callerSub> AND SK = <SK of each item returned by the Query above>',
    note:
      'One UpdateItem per unread item found above, issued in parallel via `Promise.all` — sets ' +
      '`read = true`. Skipped entirely (no writes) when the caller has zero unread notifications.',
  },
];

/**
 * Every DynamoDB access issued by `PATCH /{role}/notifications/{notificationId}`
 * (`markOneAsRead` in service.ts).
 */
const MARK_ONE_DYNAMODB: DynamoAccess[] = [
  {
    command: 'Get',
    keyCondition: 'PK = USER#<callerSub> AND SK = NOTIFICATION#<notificationId>',
    note:
      'Scoped to the caller’s own partition — a forged/foreign notificationId simply yields no ' +
      'item, so the service throws NotFoundError (404), never ForbiddenError, avoiding existence ' +
      'leakage. This Get is also how ownership is verified; there is no separate authorization check.',
  },
  {
    command: 'Update',
    keyCondition: 'PK = USER#<callerSub> AND SK = NOTIFICATION#<notificationId>',
    note:
      'Only issued if the Get above found an item that was not already read — sets `read = true`. ' +
      'Skipped (item returned as-is) when the notification was already read.',
  },
];

/**
 * Register the three operations (list, mark-all-read, mark-one-read) for one
 * role-prefixed path set. Called once per entry in `ROLE_PREFIXES` below so
 * every path the API actually serves is registered, without duplicating the
 * schema definitions above per role.
 */
function registerNotificationOperations(role: RolePrefix): void {
  const label = OPERATION_ID_LABEL[role];
  const base = `/${role}/notifications`;
  // A WebAdmin acts as itself on /web-admin routes, so only the impersonatable roles declare the header.
  const register = role === 'web-admin' ? registerOperation : registerRoleOperation;

  register('get', base, {
    operationId: `list${label}Notifications`,
    summary: `List the calling ${role}'s notifications`,
    tags: [role],
    purpose:
      'Backs the notification bell and notification list page (frontend/src/app/shared/notifications) ' +
      `for the ${role} role. One Lambda (\`NotificationsFunction\`) serves this identically across all ` +
      'four role prefixes — the prefix only scopes which JWT-authenticated role may call it, not the ' +
      'behaviour, which is always "list the caller\'s own notifications by their JWT sub".',
    implementation: IMPLEMENTATION,
    dynamodb: LIST_DYNAMODB,
    responses: {
      200: {
        description: "The caller's notifications, newest first.",
        content: { 'application/json': { schema: NotificationListResponse } },
      },
      500: errorResponses[500],
    },
  });

  register('patch', base, {
    operationId: `markAll${label}NotificationsRead`,
    summary: `Mark all of the calling ${role}'s unread notifications as read`,
    tags: [role],
    purpose:
      'Backs the notification list page’s "mark all as read" action. Distinct from the ' +
      '`{notificationId}` variant below: this route takes no path parameter and no request body — ' +
      'it marks every one of the caller’s currently-unread notifications and returns only a count, ' +
      'never the notifications themselves.',
    implementation: IMPLEMENTATION,
    dynamodb: MARK_ALL_DYNAMODB,
    responses: {
      200: {
        description: 'How many notifications were marked read.',
        content: { 'application/json': { schema: MarkAllNotificationsReadResponse } },
      },
      500: errorResponses[500],
    },
  });

  register('patch', `${base}/{notificationId}`, {
    operationId: `markOne${label}NotificationRead`,
    summary: `Mark one of the calling ${role}'s notifications as read`,
    tags: [role],
    purpose:
      'Backs marking a single notification as read from the notification bell/list — e.g. clicking ' +
      'an individual unread item. Distinct from the no-id variant above: this route addresses exactly ' +
      'one notification by its `notificationId` path parameter and returns that notification (now ' +
      'read), not a count. An empty-string `notificationId` (present-but-blank path param) is rejected ' +
      'with 400 before the service is called, rather than silently falling through to mark-all semantics.',
    implementation: IMPLEMENTATION,
    dynamodb: MARK_ONE_DYNAMODB,
    requestParams: { path: MarkOneNotificationPathParams },
    responses: {
      200: {
        description: 'The notification, now marked read.',
        content: { 'application/json': { schema: NotificationResponse } },
      },
      400: errorResponses[400],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  });
}

for (const role of ROLE_PREFIXES) registerNotificationOperations(role);

export type NotificationResponse = z.infer<typeof NotificationResponse>;
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadResponse>;
export type MarkOneNotificationPathParams = z.infer<typeof MarkOneNotificationPathParams>;
