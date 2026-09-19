import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  ButtonComponent,
  EmptyStateComponent,
  ErrorAlertComponent,
  LoadingSpinnerComponent,
} from '@common-daltime';
import { AuthService } from '../../core/auth/auth';
import { ImpersonationService } from '../../core/services/impersonation.service';
import type { NotificationResponse } from './notifications.service';
import type { UserRole } from '../../core/auth/user-role.model';
import { NotificationsService } from './notifications.service';
import { formatNotificationTimestamp, getNotificationDisplay } from './notification-display.util';

/**
 * Full-page notifications view rendered at /notifications. Replaces the
 * inline dropdown that used to live in NotificationBellComponent (story #265).
 *
 * Role resolution mirrors the navbar's effectiveRole() pattern: when a
 * Web-Admin is impersonating another user, ImpersonationService.viewingAs()
 * is set and its role is used, so the page automatically calls the impersonated
 * role's /notifications endpoint. The impersonation interceptor then rewrites
 * that request transparently — no notifications-specific impersonation code
 * is needed here.
 */
@Component({
  selector: 'app-notifications-page',
  imports: [ButtonComponent, EmptyStateComponent, ErrorAlertComponent, LoadingSpinnerComponent],
  templateUrl: './notifications-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPageComponent {
  private readonly notificationsService = inject(NotificationsService);
  private readonly authService = inject(AuthService);
  private readonly impersonationService = inject(ImpersonationService);

  /**
   * Effective role — mirrors the navbar's effectiveRole() computed: prefer the
   * impersonated role when a Web-Admin is emulating, fall back to the real role.
   * Cast to UserRole because at this route we are always authenticated (authGuard
   * ensures it) so roleSignal() is guaranteed non-null.
   */
  protected readonly effectiveRole = computed<UserRole>(
    () =>
      (this.impersonationService.viewingAs()?.role ?? this.authService.roleSignal()) as UserRole,
  );

  protected readonly notifications = signal<NotificationResponse[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly markingAll = signal(false);

  /** Unread count derived client-side from the list — no separate endpoint. */
  protected readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );

  protected readonly hasUnread = computed(() => this.unreadCount() > 0);

  /** Exposes the display label/icon helper to the template (pure function — independently unit-testable). */
  protected readonly getDisplay = getNotificationDisplay;
  protected readonly formatTimestamp = formatNotificationTimestamp;

  constructor() {
    // Load on component init so the page is populated as soon as it mounts.
    this.load();
  }

  /** Fetches the notification list for the current effective role, newest first. */
  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.notificationsService.list(this.effectiveRole()).subscribe({
      next: (list) => {
        this.notifications.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load notifications. Please try again.');
        this.loading.set(false);
      },
    });
  }

  /** Wired to ErrorAlertComponent's retry output. */
  protected retryLoad(): void {
    this.load();
  }

  /**
   * Marks a single notification as read. Uses an optimistic local update
   * (flips `read` immediately in the signal) so the unread dot clears without
   * waiting on a refetch. On failure, rolls back the optimistic change so the
   * UI never shows a read-state the server didn't actually persist.
   */
  protected markOneAsRead(notification: NotificationResponse): void {
    if (notification.read) return;

    // Optimistic update.
    this.notifications.update((list) =>
      list.map((n) =>
        n.notification_id === notification.notification_id ? { ...n, read: true } : n,
      ),
    );

    this.notificationsService
      .markOneAsRead(this.effectiveRole(), notification.notification_id)
      .subscribe({
        next: (updated) => {
          // Reconcile with the server's canonical response.
          this.notifications.update((list) =>
            list.map((n) => (n.notification_id === updated.notification_id ? updated : n)),
          );
        },
        error: () => {
          // Roll back — server never persisted the change.
          this.notifications.update((list) =>
            list.map((n) =>
              n.notification_id === notification.notification_id ? { ...n, read: false } : n,
            ),
          );
          this.error.set('Failed to mark notification as read. Please try again.');
        },
      });
  }

  /**
   * Marks every notification as read via the mark-all route. Saves a snapshot
   * of the current list before the call so it can be rolled back on failure.
   */
  protected markAllAsRead(): void {
    if (!this.hasUnread() || this.markingAll()) return;

    this.markingAll.set(true);
    const previous = this.notifications();

    this.notificationsService.markAllAsRead(this.effectiveRole()).subscribe({
      next: () => {
        this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
        this.markingAll.set(false);
      },
      error: () => {
        // Roll back to the pre-call snapshot.
        this.notifications.set(previous);
        this.markingAll.set(false);
        this.error.set('Failed to mark all notifications as read. Please try again.');
      },
    });
  }

  /** trackBy function for @for loop — required for OnPush change detection performance. */
  protected trackByNotificationId(_: number, n: NotificationResponse): string {
    return n.notification_id;
  }
}
