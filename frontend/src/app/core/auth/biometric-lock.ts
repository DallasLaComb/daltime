import { Injectable, InjectionToken, Injector, inject, signal } from '@angular/core';
import type { AccessControl, NativeBiometricPlugin } from '@capgo/capacitor-native-biometric';
import { IS_NATIVE_PLATFORM, TokenStorage } from '../storage/token-storage';
import { LoggerService } from '../logging/logger.service';

/** Secure-storage key for the user's choice. Absent means "on" (the default); 'off' disables the lock. */
export const BIOMETRIC_LOCK_KEY = 'daltime_biometric_lock';

/** Set to 'saved' while a password login is stored in the Keychain/Keystore behind biometrics. */
export const BIOMETRIC_LOGIN_KEY = 'daltime_biometric_login';

// Namespace for the stored login inside the plugin's credential store.
const CREDENTIALS_SERVER = 'daltime';
// `AccessControl.BIOMETRY_ANY` in the plugin (a type-only import here, like `BiometryType` below): the item
// can only be read after a biometric, and survives adding a new fingerprint/face.
const BIOMETRY_ANY = 2;

export interface SavedLogin {
  username: string;
  password: string;
}

/**
 * Loads the biometric plugin lazily so it stays out of the web bundle's startup path.
 * Wrapped in an object on purpose — never return a Capacitor plugin proxy straight from an async
 * function (see SECURE_STORAGE_LOADER in token-storage.ts).
 */
export const BIOMETRIC_LOADER = new InjectionToken<
  () => Promise<{ plugin: NativeBiometricPlugin }>
>('BIOMETRIC_LOADER', {
  providedIn: 'root',
  factory: () => async () => {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    return { plugin: NativeBiometric };
  },
});

// Mirrors `BiometryType` in the plugin, which is only a type here so the enum stays out of the web bundle.
const BIOMETRY_LABELS: Record<number, string> = {
  1: 'Touch ID',
  2: 'Face ID',
  3: 'fingerprint unlock',
  4: 'face unlock',
  5: 'iris unlock',
};

/**
 * Face ID / Touch ID / fingerprint app lock.
 *
 * The tokens stay in the Keychain/Keystore exactly as before (see TokenStorage). This service only
 * gates *restoring* the saved session on a cold start: `AuthService.initialize()` calls `unlock()`
 * and, if it returns false, leaves the user logged out on the normal password screen. The stored
 * tokens are not deleted, so the next launch can still unlock them.
 *
 * Web is unaffected: every method is a no-op there and `unlock()` resolves true.
 */
@Injectable({ providedIn: 'root' })
export class BiometricLock {
  private readonly native = inject(IS_NATIVE_PLATFORM);
  private readonly tokens = inject(TokenStorage);
  private readonly loadPlugin = inject(BIOMETRIC_LOADER);
  // LoggerService depends (transitively, via AuthService) on this service, so it cannot be a
  // constructor-time field here without a circular DI error — resolved lazily instead.
  private readonly injector = inject(Injector);

  // TokenStorage is hydrated by an app initializer before anything can inject this service.
  private readonly _enabled = signal(this.tokens.get(BIOMETRIC_LOCK_KEY) !== 'off');
  private readonly _hasCredentials = signal(this.tokens.get(BIOMETRIC_LOGIN_KEY) === 'saved');
  private readonly _supported = signal(false);
  private readonly _label = signal('biometric unlock');

  /** The user's preference (default on). Only meaningful when `supported()` is true. */
  readonly enabled = this._enabled.asReadonly();
  /** True while a password login is stored behind biometrics, so sign-in works even after Sign out. */
  readonly hasCredentials = this._hasCredentials.asReadonly();
  /** True once `refreshSupport()` found a usable biometric or device passcode. Always false on web. */
  readonly supported = this._supported.asReadonly();
  /** Display name for the available method, e.g. "Face ID". */
  readonly label = this._label.asReadonly();

  /** Checks whether this device can prompt. Never throws. */
  async refreshSupport(): Promise<void> {
    if (!this.native) return;

    try {
      const { plugin } = await this.loadPlugin();
      const result = await plugin.isAvailable({ useFallback: true });
      this._supported.set(result.isAvailable);
      this._label.set(BIOMETRY_LABELS[result.biometryType] ?? 'biometric unlock');
    } catch (error: unknown) {
      this.injector.get(LoggerService).error('Biometric availability check failed', error);
      this._supported.set(false);
    }
  }

  /**
   * Resolves true when the saved session may be restored: web, lock turned off, or nothing to prompt with
   * (no biometrics or passcode on the device — the OS can't offer a lock, and a password login is still
   * required if the tokens expire). Resolves false when the prompt is cancelled/failed or the plugin
   * errors, so a broken plugin fails closed to the password screen instead of bypassing the lock.
   */
  async unlock(): Promise<boolean> {
    if (!this.native || !this._enabled()) return true;

    try {
      const { plugin } = await this.loadPlugin();
      const { isAvailable } = await plugin.isAvailable({ useFallback: true });
      if (!isAvailable) return true;

      await this.prompt(plugin);
      return true;
    } catch (error: unknown) {
      // Cancel and failed-match are routine; the message is only useful when debugging.
      this.injector.get(LoggerService).warn('Biometric unlock not granted', error);
      return false;
    }
  }

  /**
   * Turns the lock on or off. Turning it on asks for a biometric first so the user knows it works
   * before it can lock them out. Resolves to the resulting state of `enabled()`.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!this.native) return false;

    if (enabled) {
      try {
        const { plugin } = await this.loadPlugin();
        await this.prompt(plugin);
      } catch (error: unknown) {
        this.injector.get(LoggerService).warn('Biometric lock not enabled', error);
        return this._enabled();
      }
    }

    this._enabled.set(enabled);
    await this.tokens.set(BIOMETRIC_LOCK_KEY, enabled ? 'on' : 'off');
    return enabled;
  }

  /**
   * Stores the email + password in the Keychain/Keystore, readable only after a biometric
   * (`BIOMETRY_ANY`). Resolves false (and stores nothing) if that fails. Never throws.
   */
  async saveCredentials(username: string, password: string): Promise<boolean> {
    if (!this.native) return false;

    try {
      const { plugin } = await this.loadPlugin();
      await plugin.setCredentials({
        username,
        password,
        server: CREDENTIALS_SERVER,
        accessControl: BIOMETRY_ANY as AccessControl,
        title: 'Save your DalTime sign-in',
        negativeButtonText: 'Not now',
      });
    } catch (error: unknown) {
      this.injector.get(LoggerService).warn('Saving biometric sign-in failed', error);
      return false;
    }

    this._hasCredentials.set(true);
    await this.tokens.set(BIOMETRIC_LOGIN_KEY, 'saved');
    return true;
  }

  /** Prompts for a biometric and returns the stored login, or null when cancelled/failed/none saved. */
  async getCredentials(): Promise<SavedLogin | null> {
    if (!this.native || !this._hasCredentials()) return null;

    try {
      const { plugin } = await this.loadPlugin();
      const { username, password } = await plugin.getSecureCredentials({
        server: CREDENTIALS_SERVER,
        reason: 'Sign in to DalTime',
        title: 'Sign in to DalTime',
        negativeButtonText: 'Use password',
      });
      return { username, password };
    } catch (error: unknown) {
      this.injector.get(LoggerService).warn('Biometric sign-in not granted', error);
      return null;
    }
  }

  /** Forgets the stored login (turned off in the profile, or the saved password no longer works). */
  async clearCredentials(): Promise<void> {
    if (!this.native) return;

    this._hasCredentials.set(false);
    await this.tokens.remove(BIOMETRIC_LOGIN_KEY);
    try {
      const { plugin } = await this.loadPlugin();
      await plugin.deleteCredentials({ server: CREDENTIALS_SERVER });
    } catch (error: unknown) {
      // Nothing stored (or already gone) is the goal state anyway.
      this.injector.get(LoggerService).warn('Deleting biometric sign-in failed', error);
    }
  }

  private prompt(plugin: NativeBiometricPlugin): Promise<void> {
    return plugin.verifyIdentity({
      reason: 'Unlock DalTime',
      title: 'Unlock DalTime',
      negativeButtonText: 'Use password',
      // iOS only: offer the device passcode after Face ID fails. Android ignores it.
      useFallback: true,
    });
  }
}
