import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@common-daltime';
import { ProfileService, type OrgAdminProfileResponse } from './profile.service';

@Component({
  selector: 'app-org-admin-profile',
  imports: [ButtonComponent],
  templateUrl: './profile.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgAdminProfileComponent {
  private readonly profileService = inject(ProfileService);

  readonly profile = signal<OrgAdminProfileResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Edit state
  readonly editing = signal(false);
  readonly editName = signal('');
  readonly editSubmitted = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saveSuccess = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.profileService.get().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load profile');
        this.loading.set(false);
      },
    });
  }

  startEdit(): void {
    this.editName.set(this.profile()?.name ?? '');
    this.editSubmitted.set(false);
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  save(): void {
    this.editSubmitted.set(true);
    if (!this.editName().trim()) return;

    this.saving.set(true);
    this.saveError.set(null);

    this.profileService.update({ name: this.editName() }).subscribe({
      next: (updated) => {
        this.profile.set(updated);
        this.saving.set(false);
        this.editing.set(false);
        this.saveSuccess.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error ?? 'Failed to save profile');
      },
    });
  }
}
