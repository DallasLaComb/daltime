import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@common-daltime';
import { ImpersonationService } from '../../../core/services/impersonation.service';
import { ImpersonateService } from './impersonate.service';
import { OrganizationService } from '../../../services/organization.service';
import type { Organization } from '../../../core/models/organization.model';
import type { ImpersonateUserSummary } from './impersonate.service';
import { ROLE_DASHBOARD_MAP } from '../../../core/auth/user-role.model';

type ImpersonatableRole = 'OrgAdmin' | 'Manager' | 'Employee';

const ROLES: { value: ImpersonatableRole; label: string }[] = [
  { value: 'OrgAdmin', label: 'Org Admin' },
  { value: 'Manager', label: 'Manager' },
  { value: 'Employee', label: 'Employee' },
];

@Component({
  selector: 'app-impersonate',
  imports: [ButtonComponent],
  templateUrl: './impersonate.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImpersonateComponent {
  private readonly router = inject(Router);
  private readonly impersonationService = inject(ImpersonationService);
  private readonly impersonateService = inject(ImpersonateService);
  private readonly orgService = inject(OrganizationService);

  protected readonly roles = ROLES;

  // ── Step 1: Organisations ───────────────────────────────────────────────
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly orgsLoading = signal(true);
  protected readonly orgsError = signal<string | null>(null);
  protected readonly selectedOrgId = signal<string | null>(null);

  protected readonly selectedOrg = computed(
    () => this.orgs().find((o) => o.org_id === this.selectedOrgId()) ?? null,
  );

  // ── Step 2: Role ────────────────────────────────────────────────────────
  protected readonly selectedRole = signal<ImpersonatableRole | null>(null);

  // ── Step 3: Users ───────────────────────────────────────────────────────
  protected readonly users = signal<ImpersonateUserSummary[]>([]);
  protected readonly usersLoading = signal(false);
  protected readonly usersError = signal<string | null>(null);
  protected readonly selectedUserId = signal<string | null>(null);

  protected readonly selectedUser = computed(
    () => this.users().find((u) => u.user_id === this.selectedUserId()) ?? null,
  );

  // ── Action state ────────────────────────────────────────────────────────
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);

  constructor() {
    this.orgService.getAll().subscribe({
      next: (orgs) => {
        this.orgs.set(orgs);
        this.orgsLoading.set(false);
      },
      error: () => {
        this.orgsError.set('Failed to load organisations.');
        this.orgsLoading.set(false);
      },
    });
  }

  protected selectOrg(orgId: string): void {
    this.selectedOrgId.set(orgId);
    this.selectedRole.set(null);
    this.users.set([]);
    this.selectedUserId.set(null);
    this.startError.set(null);
  }

  protected selectRole(role: ImpersonatableRole): void {
    this.selectedRole.set(role);
    this.selectedUserId.set(null);
    this.startError.set(null);
    this.loadUsers();
  }

  protected selectUser(userId: string): void {
    this.selectedUserId.set(userId);
    this.startError.set(null);
  }

  private loadUsers(): void {
    const orgId = this.selectedOrgId();
    const role = this.selectedRole();
    if (!orgId || !role) return;

    this.usersLoading.set(true);
    this.usersError.set(null);
    this.users.set([]);

    this.impersonateService.listUsers(orgId, role).subscribe({
      next: (users) => {
        this.users.set(users);
        this.usersLoading.set(false);
      },
      error: () => {
        this.usersError.set('Failed to load users.');
        this.usersLoading.set(false);
      },
    });
  }

  protected startImpersonation(): void {
    const userId = this.selectedUserId();
    if (!userId) return;

    this.starting.set(true);
    this.startError.set(null);

    this.impersonateService.getContextAndStartSession(userId).subscribe({
      next: (ctx) => {
        this.impersonationService.startImpersonation(ctx);
        void this.router.navigate([ROLE_DASHBOARD_MAP[ctx.role]]);
      },
      error: () => {
        this.startError.set('Failed to start impersonation. Please try again.');
        this.starting.set(false);
      },
    });
  }

  protected cancel(): void {
    void this.router.navigate(['/web-admin']);
  }
}
