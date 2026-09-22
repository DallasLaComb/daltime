import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ButtonComponent, ConfirmationModalComponent } from '@common-daltime';
import { AuthService } from '../../core/auth/auth';
import { ImpersonationService } from '../../core/services/impersonation.service';
import { ImpersonationBannerComponent } from '../components/impersonation-banner/impersonation-banner';
import { ROLE_DASHBOARD_MAP } from '../../core/auth/user-role.model';
import { NotificationBellComponent } from '../notifications/notification-bell';

@Component({
  selector: 'app-navbar',
  imports: [
    RouterLink,
    RouterLinkActive,
    ButtonComponent,
    ConfirmationModalComponent,
    ImpersonationBannerComponent,
    NotificationBellComponent,
  ],
  templateUrl: './navbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Navbar {
  protected readonly authService = inject(AuthService);
  protected readonly impersonationService = inject(ImpersonationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly menuOpen = signal(false);
  protected readonly showSignOutModal = signal(false);
  protected readonly signingOut = signal(false);

  constructor() {
    // Close the mobile menu on every navigation so it never stays open after a touch-triggered
    // route change where the (click)="closeMenu()" binding on the link fires too late or not at all.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  /**
   * When impersonating, show the impersonated user's role in the nav so
   * the web-admin sees the same nav links as the target user.
   */
  protected readonly effectiveRole = computed(
    () => this.impersonationService.viewingAs()?.role ?? this.authService.roleSignal(),
  );

  protected readonly dashboardRoute = computed(() => {
    const r = this.effectiveRole();
    return r ? ROLE_DASHBOARD_MAP[r] : '/';
  });

  protected readonly profileRoute = computed(() => {
    const r = this.effectiveRole();
    return r ? `${ROLE_DASHBOARD_MAP[r]}/profile` : '/';
  });

  /**
   * Combines the authenticated user's given name and family name into a single
   * display string. Returns an empty string when neither attribute has been set
   * (e.g. before the Cognito GetUser call completes), which hides the element
   * via the @if guard in the template.
   */
  protected readonly displayName = computed(() => {
    const first = this.authService.firstName();
    const last = this.authService.lastName();
    return `${first} ${last}`.trim();
  });

  protected endImpersonation(): void {
    this.impersonationService.endImpersonation();
    void this.router.navigate(['/web-admin']);
  }

  protected navigateToLogin(): void {
    this.router.navigate(['/login']);
  }

  protected navigateToProfile(): void {
    this.closeMenu();
    this.router.navigate([this.profileRoute()]);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected openSignOutModal(): void {
    this.closeMenu();
    this.showSignOutModal.set(true);
  }

  protected closeSignOutModal(): void {
    this.showSignOutModal.set(false);
  }

  protected confirmSignOut(): void {
    this.impersonationService.endImpersonation();
    this.showSignOutModal.set(false);
    this.signingOut.set(false);
    this.authService.logout();
  }
}
