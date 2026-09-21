import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BiometricLock } from '../../../core/auth/biometric-lock';
import { ButtonComponent } from '../button/button';

export interface ProfileData {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface UpdateProfileData {
  first_name: string;
  last_name: string;
  phone: string;
}

@Component({
  selector: 'app-profile-page',
  imports: [ButtonComponent],
  templateUrl: './profile-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePageComponent {
  loading = input<boolean>(false);
  loadError = input<string | null>(null);
  profile = input<ProfileData | null>(null);
  saving = input<boolean>(false);
  saveSuccess = input<boolean>(false);
  saveError = input<string | null>(null);
  showDashboard = input<boolean>(true);

  retried = output<void>();
  navigatedBack = output<void>();
  saved = output<UpdateProfileData>();
  startedEditing = output<void>();

  protected readonly biometricLock = inject(BiometricLock);
  protected readonly editing = signal(false);
  protected readonly editFirstName = signal('');
  protected readonly editLastName = signal('');
  protected readonly editPhone = signal('');
  protected readonly editSubmitted = signal(false);

  constructor() {
    void this.biometricLock.refreshSupport();
    effect(() => {
      if (this.saveSuccess()) {
        this.editing.set(false);
      }
    });
  }

  protected onBiometricToggled(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Enabling asks for a biometric first; if that is declined the checkbox snaps back to the saved state.
    void this.biometricLock.setEnabled(input.checked).then((enabled) => {
      input.checked = enabled;
    });
  }

  protected startEdit(): void {
    const p = this.profile()!;
    this.editFirstName.set(p.first_name);
    this.editLastName.set(p.last_name);
    this.editPhone.set(p.phone ?? '');
    this.editSubmitted.set(false);
    this.startedEditing.emit();
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected save(): void {
    this.editSubmitted.set(true);
    if (!this.editFirstName().trim() || !this.editLastName().trim()) return;
    this.saved.emit({
      first_name: this.editFirstName(),
      last_name: this.editLastName(),
      phone: this.editPhone(),
    });
  }
}
