import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import { AuthService, INCORRECT_CREDENTIALS_ERROR } from '../auth';
import { BiometricLock } from '../biometric-lock';
import { LoginComponent } from './login';

interface Options {
  savedSession?: boolean;
  savedLogin?: boolean;
  supported?: boolean;
  enabled?: boolean;
}

function setup(options: Options = {}) {
  const { savedSession = false, savedLogin = false, supported = true, enabled = true } = options;
  const authService = {
    hasSavedSession: vi.fn().mockReturnValue(savedSession),
    signInWithBiometrics: vi.fn().mockResolvedValue(true),
    login: vi.fn().mockResolvedValue({ success: true }),
  };
  const biometricLock = {
    supported: signal(supported),
    enabled: signal(enabled),
    hasCredentials: signal(savedLogin),
    label: signal('Face ID'),
    refreshSupport: vi.fn().mockResolvedValue(undefined),
    saveCredentials: vi.fn().mockResolvedValue(true),
    getCredentials: vi.fn().mockResolvedValue({ username: 'a@b.com', password: 'pw' }),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      ...APP_TEST_PROVIDERS,
      { provide: AuthService, useValue: authService },
      { provide: BiometricLock, useValue: biometricLock },
    ],
  });
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const byId = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, el, authService, biometricLock, router, byId };
}

describe('LoginComponent biometric sign-in', () => {
  describe('button visibility', () => {
    it('shows when a session is saved, biometrics work and the lock is on', () => {
      const { byId, biometricLock } = setup({ savedSession: true });

      expect(byId('biometric-sign-in-btn')?.textContent).toContain('Sign in with Face ID');
      expect(biometricLock.refreshSupport).toHaveBeenCalled();
    });

    it('shows after Sign out when a login is saved behind Face ID', () => {
      const { byId } = setup({ savedLogin: true, savedSession: false });

      expect(byId('biometric-sign-in-btn')).not.toBeNull();
    });

    it.each([
      ['nothing is saved', { savedSession: false, savedLogin: false }],
      ['the device cannot do biometrics', { savedLogin: true, supported: false }],
      ['the user turned the lock off', { savedLogin: true, enabled: false }],
    ])('is hidden when %s', (_name, options) => {
      expect(setup(options).byId('biometric-sign-in-btn')).toBeNull();
    });
  });

  describe('save-this-login checkbox', () => {
    it('is offered (checked) when biometrics work and nothing is saved yet', () => {
      const checkbox = setup().byId('save-biometric-checkbox') as HTMLInputElement;

      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(true);
    });

    it.each([
      ['a login is already saved', { savedLogin: true }],
      ['the device cannot do biometrics', { supported: false }],
      ['the lock is off', { enabled: false }],
    ])('is hidden when %s', (_name, options) => {
      expect(setup(options).byId('save-biometric-checkbox')).toBeNull();
    });

    it('saves the login after a successful password sign-in when ticked', async () => {
      const { fixture, biometricLock } = setup();
      fixture.componentInstance.email.set('a@b.com');
      fixture.componentInstance.password.set('pw');

      await fixture.componentInstance.onSubmit();

      expect(biometricLock.saveCredentials).toHaveBeenCalledWith('a@b.com', 'pw');
    });

    it('does not save when unticked or when the sign-in fails', async () => {
      const { fixture, authService, biometricLock } = setup();
      fixture.componentInstance.email.set('a@b.com');
      fixture.componentInstance.password.set('pw');

      fixture.componentInstance.saveBiometricLogin.set(false);
      await fixture.componentInstance.onSubmit();

      fixture.componentInstance.saveBiometricLogin.set(true);
      authService.login.mockResolvedValue({ success: false, error: 'nope' });
      await fixture.componentInstance.onSubmit();

      expect(biometricLock.saveCredentials).not.toHaveBeenCalled();
    });
  });

  describe('tapping the button', () => {
    it('restores the saved session when no login is saved', async () => {
      const { fixture, byId, authService } = setup({ savedSession: true });

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();

      expect(authService.signInWithBiometrics).toHaveBeenCalledTimes(1);
      expect(authService.login).not.toHaveBeenCalled();
      expect(byId('login-error')).toBeNull();
    });

    it('shows an error pointing at the password when the session restore fails', async () => {
      const { fixture, byId, authService } = setup({ savedSession: true });
      authService.signInWithBiometrics.mockResolvedValue(false);

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(byId('login-error')?.textContent).toContain("Face ID didn't work");
    });

    it('signs in with the saved login after Face ID', async () => {
      const { fixture, byId, authService, biometricLock } = setup({ savedLogin: true });

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();

      expect(biometricLock.getCredentials).toHaveBeenCalledTimes(1);
      expect(authService.login).toHaveBeenCalledWith('a@b.com', 'pw');
      expect(authService.signInWithBiometrics).not.toHaveBeenCalled();
    });

    it('shows an error and does not sign in when Face ID is cancelled', async () => {
      const { fixture, byId, authService, biometricLock } = setup({ savedLogin: true });
      biometricLock.getCredentials.mockResolvedValue(null);

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(authService.login).not.toHaveBeenCalled();
      expect(byId('login-error')?.textContent).toContain("Face ID didn't work");
    });

    it('forgets a stale saved password and tells the user to sign in with it', async () => {
      const { fixture, byId, authService, biometricLock } = setup({ savedLogin: true });
      authService.login.mockResolvedValue({ success: false, error: INCORRECT_CREDENTIALS_ERROR });

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(biometricLock.clearCredentials).toHaveBeenCalledTimes(1);
      expect(byId('login-error')?.textContent).toContain('out of date');
    });

    it('routes to change-password when the saved login hits a new-password challenge', async () => {
      const { fixture, byId, authService, biometricLock, router } = setup({ savedLogin: true });
      authService.login.mockResolvedValue({ success: false, challenge: 'NEW_PASSWORD_REQUIRED' });

      byId('biometric-sign-in-btn')?.click();
      await fixture.whenStable();

      expect(biometricLock.clearCredentials).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(['/change-password']);
    });
  });
});
