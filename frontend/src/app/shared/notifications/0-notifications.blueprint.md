# Notifications (Frontend) — Blueprint

Parent story: GitHub Issue #243 (original bell/panel). Story #265 (bell → page navigation).
Frontend sub-issues: #250 (original implementation), #266 (bell → /notifications page).

Status: **Implemented (updated for story #265).**

---

## 1. Summary

The notifications feature consists of two components that work together:

1. **`NotificationBellComponent`** (`notification-bell.ts/.html`) — a lightweight bell icon in
   the shared navbar. It loads the notification list eagerly on mount so the unread-count badge
   is accurate as soon as the navbar renders. Clicking the bell navigates to `/notifications`
   using Angular's Router — no inline dropdown or modal.

2. **`NotificationsPageComponent`** (`notifications-page.ts/.html`) — a dedicated full-page
   view rendered at `/notifications`. It fetches and displays the caller's notification list,
   supports marking a single notification as read (optimistic update with rollback on failure),
   and supports marking all notifications as read at once.

Both components call the existing backend slice at
`backend/src/functions/shared/notifications` via `NotificationsService` — no backend changes
were introduced by either story.

---

## 2. Why this location

Both files live under `frontend/src/app/shared/notifications/` rather than under any single
role's `features/<role>/` directory for the same reason as the backend's own
`backend/src/functions/shared/notifications/`: notifications are cross-role (a notification
belongs to a Cognito `sub`, not to a role folder). The navbar that hosts the bell is itself
already in `shared/`, so co-locating the notifications feature here is the natural fit.

The model (`PublicNotification`, `NotificationType`, `MarkAllReadResponse`) lives at
`frontend/src/app/core/models/notification.model.ts`, matching this repo's convention of
co-locating all entity model files under `core/models/`.

---

## 3. Files

```
frontend/src/app/core/models/notification.model.ts        # PublicNotification, NotificationType, MarkAllReadResponse
frontend/src/app/shared/notifications/
  notifications.service.ts          # GET list / PATCH mark-all / PATCH mark-one, role-prefixed
  notification-display.util.ts      # type -> {label, icon} mapping + generic fallback, timestamp formatting
  notification-bell.ts              # Navbar bell: unread badge + router.navigate(['/notifications'])
  notification-bell.html
  notifications-page.ts             # Full-page view at /notifications
  notifications-page.html
  0-notifications.blueprint.md
  *.spec.ts                         # Unit tests (service, bell component, display util)
frontend/src/app/app.routes.ts      # /notifications route registered here
```

Integration point: `frontend/src/app/shared/navbar/navbar.ts` renders
`<app-notification-bell [role]="effectiveRole()!" />` bound to the exact same `effectiveRole()`
signal the navbar already uses for Web-Admin emulation.

---

## 4. Route and auth guarding

The `/notifications` route is registered in `app.routes.ts` with `canMatch: [authGuard]`.
It uses only `authGuard` (not `roleGuard`) because all four roles (Web-Admin, Org-Admin,
Manager, Employee) are permitted. `roleGuard` is used only when a route is restricted to a
subset of roles — here it would incorrectly block roles not listed in `data.roles`.

Unauthenticated users who navigate directly to `/notifications` are redirected to `/login`
by `authGuard`, consistent with every other protected route in this app.

---

## 5. Role resolution / Web-Admin emulation parity

`NotificationsPageComponent` resolves its effective role with the same pattern the navbar uses:

```ts
const effectiveRole = computed<UserRole>(
  () => impersonationService.viewingAs()?.role ?? (authService.roleSignal() as UserRole),
);
```

This means:

- A Manager sees `GET /manager/notifications`.
- A Web-Admin NOT impersonating sees `GET /web-admin/notifications`.
- A Web-Admin impersonating an Employee sees `GET /employee/notifications`, which
  `impersonationInterceptor` transparently adds the `X-Impersonate-User` header (the URL is unchanged).

No notifications-specific impersonation code exists — the pattern is inherited from the
interceptor and the effectiveRole pattern already established by the navbar.

---

## 6. The `encodeURIComponent` landmine — handled once, in the service

The backend's public `notification_id` is the composite `<ISO-timestamp>#<uuid>`, containing
literal `#` and `:` characters. `NotificationsService.markOneAsRead()` calls
`encodeURIComponent(notificationId)` inside the service before building the URL, so every
call site is automatically safe. See the service file's inline comment and the spec for details.

---

## 7. Optimistic updates and rollback

`markOneAsRead()` in `NotificationsPageComponent` (mirroring the original bell component's
pattern):

- Immediately flips the targeted notification's `read` field to `true` in the local signal
  so the unread dot clears without a round-trip.
- On the server's success response, reconciles the local item with the server's canonical
  `PublicNotification` response.
- On failure, rolls back the optimistic flip so the UI never shows a read-state the server
  didn't persist.

`markAllAsRead()` snapshots the pre-call notification list and restores it on failure.

---

## 8. Generic rendering / extensibility

`notification-display.util.ts`'s `getNotificationDisplay(type)` provides a nicer label + icon
for today's 4 known `NotificationType` values but falls back to a generic
`{ label: 'Notification', icon: '🔔' }` for any unknown type. The raw `message` field is
**always** rendered regardless of type recognition — the component never filters or throws
on an unrecognized type. Future backend types require zero frontend changes to keep working.

---

## 9. Accessibility

- Bell button: `aria-label` (dynamic — includes unread count when present). `aria-live="polite"`
  `sr-only` region announces unread-count changes to screen readers without requiring focus.
  Badge `aria-hidden="true"` prevents double-announcing the count.
- Page heading: `<h1>` with `data-testid="notifications-page-heading"`.
- Unread count summary: `aria-live="polite"` so changes are announced dynamically.
- Each notification item: `role="button"`, `tabindex="0"`, Enter/Space-activatable,
  `aria-label` encodes read/unread state plus the message text — never color-only.
- `<time>` element with `dateTime` attribute on timestamps — semantically correct for
  machine-readable dates.

---

## 10. UI states (NotificationsPageComponent)

| State            | What renders                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| Loading          | `<app-loading-spinner>` while the list request is in flight                |
| Error            | `<app-error-alert>` with retry action; wired to `retryLoad()`              |
| Empty (no error) | `<app-empty-state>` with a friendly "all caught up" message                |
| Populated        | Notification list (`<ul>`) with per-item unread dot and mark-read on click |
| markingAll       | `<app-button [loading]="markingAll()">` handles spinner + disabled state   |

---

## 11. Out of scope

Real-time/websocket delivery, pagination, push notifications, an unread-count aggregate
endpoint (client-derived instead), dark mode support — all explicitly deferred per the
original backend blueprint and unchanged by story #265.
