import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../core/api/api-client';
import type { UserRole } from '../../core/auth/user-role.model';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend service and db layer
 * import from `@daltime/contracts`. A field renamed in the contract breaks this
 * file at compile time instead of at runtime in the browser.
 */
export type NotificationResponse = ApiSchema<'NotificationResponse'>;
export type MarkAllNotificationsReadResponse = ApiSchema<'MarkAllNotificationsReadResponse'>;

/**
 * Maps the app's internal `UserRole` (PascalCase, e.g. `'OrgAdmin'`) to the
 * **literal contract path** for that role's notifications collection.
 *
 * This exists instead of the old `ROLE_PATH_SEGMENT` + string concatenation
 * because `ApiClient` is typed by the contract: it accepts only literal paths
 * that `openapi.json` actually registers, and derives the response type from
 * the path it is given. A path assembled at runtime
 * (`` `/${segment}/notifications` ``) widens to `string` and cannot be typed.
 * Looking the whole literal up per role keeps the runtime behaviour identical
 * — the caller's role still picks the route — while every value below is
 * checked against the generated `paths` type, so a route renamed or removed in
 * the contract fails the build here.
 */
const NOTIFICATIONS_PATH = {
  WebAdmin: '/web-admin/notifications',
  OrgAdmin: '/org-admin/notifications',
  Manager: '/manager/notifications',
  Employee: '/employee/notifications',
} as const satisfies Record<UserRole, string>;

/** Literal contract paths for the single-notification route, one per role. See `NOTIFICATIONS_PATH`. */
const NOTIFICATION_BY_ID_PATH = {
  WebAdmin: '/web-admin/notifications/{notificationId}',
  OrgAdmin: '/org-admin/notifications/{notificationId}',
  Manager: '/manager/notifications/{notificationId}',
  Employee: '/employee/notifications/{notificationId}',
} as const satisfies Record<UserRole, string>;

/**
 * Calls the cross-role Notifications backend slice
 * (`backend/src/functions/shared/notifications`). One service used by all
 * four roles — the caller's `effectiveRole()` (same signal the navbar already
 * uses for Web-Admin emulation parity) determines which `{role}`-prefixed
 * route is hit. When Web-Admin is impersonating, `impersonationInterceptor`
 * (registered in app.config.ts) transparently adds the `X-Impersonate-User`
 * header to the resulting `/org-admin|manager|employee/...` request — this
 * service does not need to know about impersonation itself,
 * it always builds the URL for the real effective role, exactly like every
 * other role-scoped service in this app. `ApiClient` wraps Angular's
 * `HttpClient`, so that interceptor still sees every request made here.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiClient);

  /** GET /{role}/notifications — list the caller's notifications, newest first. */
  list(role: UserRole): Observable<NotificationResponse[]> {
    return this.api.get(NOTIFICATIONS_PATH[role]);
  }

  /** PATCH /{role}/notifications — mark all of the caller's unread notifications as read. */
  markAllAsRead(role: UserRole): Observable<MarkAllNotificationsReadResponse> {
    return this.api.patch(NOTIFICATIONS_PATH[role], {});
  }

  /**
   * PATCH /{role}/notifications/{notificationId} — mark a single notification
   * as read. CRITICAL: `notificationId` is the opaque composite public id
   * `<ISO-timestamp>#<uuid>` (e.g. `2026-06-18T12:00:00.000Z#a1b2c3d4-...`),
   * which contains literal `#` and `:` characters. `#` is a URL fragment
   * delimiter — if not percent-encoded, everything from `#` onward is
   * stripped from the request path client-side before it ever reaches
   * HttpClient/the network, so the request silently goes to the wrong URL
   * with no error surfaced. The encoding now happens inside `ApiClient.url()`,
   * which `encodeURIComponent`s every `{param}` it interpolates — so passing
   * the raw id here is correct, and double-encoding it would be the bug.
   */
  markOneAsRead(role: UserRole, notificationId: string): Observable<NotificationResponse> {
    return this.api.patch(NOTIFICATION_BY_ID_PATH[role], {}, { params: { notificationId } });
  }
}
