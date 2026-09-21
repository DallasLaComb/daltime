import { Injectable, InjectionToken, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

type SecureStorage = typeof import('capacitor-secure-storage-plugin').SecureStoragePlugin;

/** True when running inside the Capacitor native shell. Overridable in tests. */
export const IS_NATIVE_PLATFORM = new InjectionToken<boolean>('IS_NATIVE_PLATFORM', {
  providedIn: 'root',
  factory: () => Capacitor.isNativePlatform(),
});

/**
 * Loads the native secure-storage plugin lazily so it stays out of the web bundle's startup path.
 *
 * The plugin is wrapped in an object on purpose: Capacitor plugins are proxies that turn every
 * property read into a native call, so returning one straight from an async function makes
 * promise resolution read `.then` -> native `then()` -> UNIMPLEMENTED, and the promise never settles.
 */
export const SECURE_STORAGE_LOADER = new InjectionToken<() => Promise<{ plugin: SecureStorage }>>(
  'SECURE_STORAGE_LOADER',
  {
    providedIn: 'root',
    factory: () => async () => {
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      return { plugin: SecureStoragePlugin };
    },
  },
);

/**
 * Storage for the auth tokens.
 *
 * - Web: `sessionStorage`, exactly as before (cleared when the tab closes).
 * - Native (Capacitor): Keychain (iOS) / Keystore-backed storage (Android) via
 *   `capacitor-secure-storage-plugin`, so login survives the app being killed.
 *
 * The native plugin is async but auth state is read synchronously by guards and interceptors,
 * so on native we keep an in-memory cache that `hydrate()` fills once at startup
 * (see `provideAppInitializer` in app.config.ts). Writes update the cache immediately and
 * write through to native storage.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  private readonly native = inject(IS_NATIVE_PLATFORM);
  private readonly loadPlugin = inject(SECURE_STORAGE_LOADER);
  private readonly cache = new Map<string, string>();

  /** Loads the given keys from native storage into memory. No-op on web. Never throws. */
  async hydrate(keys: readonly string[]): Promise<void> {
    if (!this.native) return;

    const { plugin } = await this.loadPlugin();
    await Promise.all(
      keys.map(async (key) => {
        try {
          const { value } = await plugin.get({ key });
          this.cache.set(key, value);
        } catch {
          // The plugin rejects when the key does not exist (or on a keychain error):
          // treat both as "no value".
        }
      }),
    );
  }

  get(key: string): string | null {
    if (!this.native) return sessionStorage.getItem(key);
    return this.cache.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.native) {
      sessionStorage.setItem(key, value);
      return;
    }

    this.cache.set(key, value);
    try {
      const { plugin } = await this.loadPlugin();
      await plugin.set({ key, value });
    } catch (error: unknown) {
      // Memory copy still works for this session; the user just won't stay logged in after a restart.
      console.error('Secure storage set failed:', error instanceof Error ? error.message : error);
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.native) {
      sessionStorage.removeItem(key);
      return;
    }

    const hadValue = this.cache.delete(key);
    try {
      const { plugin } = await this.loadPlugin();
      await plugin.remove({ key });
    } catch (error: unknown) {
      // Removing a key that was never stored rejects; only worth reporting when we expected it.
      if (hadValue) {
        console.error('Secure storage remove failed:', error instanceof Error ? error.message : error);
      }
    }
  }
}
