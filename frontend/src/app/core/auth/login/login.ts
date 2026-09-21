import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, PasswordInputComponent } from '@common-daltime';
import { AuthService, INCORRECT_CREDENTIALS_ERROR } from '../auth';
import { BiometricLock } from '../biometric-lock';

@Component({
  selector: 'app-login',
  imports: [RouterLink, ButtonComponent, PasswordInputComponent],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly biometricLock = inject(BiometricLock);

  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly biometricBusy = signal(false);
  /** Whether a successful password login should also be saved behind Face ID (native only). */
  readonly saveBiometricLogin = signal(true);

  // Read once: the login page is only shown while logged out, and tokens left behind by a failed or
  // cancelled cold-start unlock can still be restored by the biometric button.
  private readonly hasSavedSession = this.authService.hasSavedSession();
  readonly biometricLabel = this.biometricLock.label;
  readonly showBiometric = computed(
    () =>
      this.biometricLock.supported() &&
      this.biometricLock.enabled() &&
      (this.biometricLock.hasCredentials() || this.hasSavedSession),
  );
  /** Offer to remember this login behind Face ID: capable device, lock on, nothing saved yet. */
  readonly offerSaveBiometric = computed(
    () =>
      this.biometricLock.supported() &&
      this.biometricLock.enabled() &&
      !this.biometricLock.hasCredentials(),
  );

  ngOnInit(): void {
    void this.biometricLock.refreshSupport();
  }

  async onSubmit(): Promise<void> {
    this.submitted.set(true);
    if (!this.email().trim() || !this.password().trim()) return;

    this.submitting.set(true);
    this.error.set(null);

    const email = this.email().trim();
    const password = this.password();
    const result = await this.authService.login(email, password);

    this.submitting.set(false);

    if (result.success && this.offerSaveBiometric() && this.saveBiometricLogin()) {
      await this.biometricLock.saveCredentials(email, password);
    }
    this.handleLoginResult(result);
  }

  async onBiometricSignIn(): Promise<void> {
    this.biometricBusy.set(true);
    this.error.set(null);

    try {
      if (this.biometricLock.hasCredentials()) {
        await this.signInWithSavedLogin();
      } else if (!(await this.authService.signInWithBiometrics())) {
        this.error.set(this.biometricFailedMessage());
      }
    } finally {
      this.biometricBusy.set(false);
    }
  }

  private async signInWithSavedLogin(): Promise<void> {
    const saved = await this.biometricLock.getCredentials();
    if (!saved) {
      this.error.set(this.biometricFailedMessage());
      return;
    }

    const result = await this.authService.login(saved.username, saved.password);
    if (result.error === INCORRECT_CREDENTIALS_ERROR || result.challenge) {
      // The password changed elsewhere (or must be reset): the saved login is stale.
      await this.biometricLock.clearCredentials();
    }
    this.handleLoginResult(
      result.error === INCORRECT_CREDENTIALS_ERROR
        ? { ...result, error: 'Your saved password is out of date. Sign in with your password.' }
        : result,
    );
  }

  private handleLoginResult(result: {
    success: boolean;
    challenge?: string;
    error?: string;
  }): void {
    if (result.success) return; // AuthService navigates to dashboard

    if (result.challenge === 'NEW_PASSWORD_REQUIRED') {
      this.router.navigate(['/change-password']);
      return;
    }

    this.error.set(result.error ?? 'Login failed.');
  }

  private biometricFailedMessage(): string {
    return `${this.biometricLabel()} didn't work. Try again or sign in with your password.`;
  }
}
