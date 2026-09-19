import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NotificationsService } from './notifications.service';
import { ButtonComponent } from '@common-daltime';
import type { UserRole } from '../../core/auth/user-role.model';
import type { NotificationResponse } from './notifications.service';

/**
 * Bell icon in the shared navbar that shows an unread-count badge and navigates
 * to the /notifications page when clicked. Previously owned a dropdown panel
 * inline; that panel was extracted to NotificationsPageComponent (story #265)
 * so the bell is now a lightweight nav trigger only.
 *
 * The `role` input drives which backend route the notifications page will call —
 * it is forwarded via router state so the page component can pick it up without
 * re-querying the auth service independently. Web-Admin emulation parity is
 * unchanged: the navbar's effectiveRole() already returns the impersonated role
 * here, and the notifications service + impersonation interceptor handle the
 * rest transparently.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [ButtonComponent],
  templateUrl: './notification-bell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent implements OnInit {
  private readonly notificationsService = inject(NotificationsService);
  private readonly router = inject(Router);

  /** Effective role driving which `{role}/notifications` route is called. Required — the navbar only renders this component when authenticated. */
  role = input.required<UserRole>();

  protected readonly notifications = signal<NotificationResponse[]>([]);
  protected readonly loading = signal(false);

  /** Count of unread notifications derived client-side from the list payload; no separate unread-count endpoint exists. */
  protected readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );

  protected readonly hasUnread = computed(() => this.unreadCount() > 0);

  ngOnInit(): void {
    // Load notifications on init (not in constructor) so the required `role`
    // input signal is guaranteed to have a value before it is accessed.
    // Using ngOnInit instead of constructor is required for input.required()
    // signals in Angular 17+ — they are only readable from ngOnInit onward.
    this.loadNotifications();
  }

  /** Fetches the caller's notifications for the current effective role to populate the unread badge. */
  private loadNotifications(): void {
    this.loading.set(true);
    this.notificationsService.list(this.role()).subscribe({
      next: (list) => {
        this.notifications.set(list);
        this.loading.set(false);
      },
      error: () => {
        // A failed badge fetch is silent — the page itself will show the error.
        this.loading.set(false);
      },
    });
  }

  /** Navigates to the /notifications page. The page owns its own data loading. */
  protected navigateToNotifications(): void {
    void this.router.navigate(['/notifications']);
  }
}
