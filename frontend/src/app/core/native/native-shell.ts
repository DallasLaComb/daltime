import { Location } from '@angular/common';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IS_NATIVE_PLATFORM } from '../storage/token-storage';
import { ROLE_DASHBOARD_MAP } from '../auth/user-role.model';

type AppPlugin = typeof import('@capacitor/app').App;
type StatusBarPlugin = typeof import('@capacitor/status-bar').StatusBar;
type StatusBarStyle = typeof import('@capacitor/status-bar').Style;

interface NativeShellPlugins {
  app: AppPlugin;
  statusBar: StatusBarPlugin;
  statusBarStyle: StatusBarStyle;
}

/**
 * Loads the Capacitor plugins lazily so they stay out of the web bundle's startup path.
 *
 * Wrapped in an object on purpose: Capacitor plugins are proxies that turn every property read into a
 * native call, so returning one straight from an async function hangs promise resolution
 * (see SECURE_STORAGE_LOADER in token-storage.ts).
 */
export const NATIVE_SHELL_LOADER = new InjectionToken<() => Promise<NativeShellPlugins>>(
  'NATIVE_SHELL_LOADER',
  {
    providedIn: 'root',
    factory: () => async () => {
      const [{ App }, { StatusBar, Style }] = await Promise.all([
        import('@capacitor/app'),
        import('@capacitor/status-bar'),
      ]);
      return { app: App, statusBar: StatusBar, statusBarStyle: Style };
    },
  },
);

/** Landing pages where the Android back button leaves the app instead of navigating back. */
const ROOT_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/login',
  ...Object.values(ROLE_DASHBOARD_MAP),
  '/employee/schedule',
]);

/**
 * Native-only behavior that makes the Capacitor shell feel like an app:
 *
 * - Status bar: the navbar is dark blue and paints under the status bar (see the safe-area padding in
 *   navbar.html), so the status bar uses light text.
 * - Android hardware/gesture back: walks back through router history and exits only at a root page.
 *
 * `init()` is a no-op on web. It never throws: a missing native capability must not break app startup.
 */
@Injectable({ providedIn: 'root' })
export class NativeShell {
  private readonly native = inject(IS_NATIVE_PLATFORM);
  private readonly loadPlugins = inject(NATIVE_SHELL_LOADER);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  async init(): Promise<void> {
    if (!this.native) return;

    let plugins: NativeShellPlugins;
    try {
      plugins = await this.loadPlugins();
    } catch (error: unknown) {
      console.error('Native shell plugins failed to load:', this.describe(error));
      return;
    }

    const { app, statusBar, statusBarStyle } = plugins;

    try {
      // `Style.Dark` means "light text for a dark background".
      await statusBar.setStyle({ style: statusBarStyle.Dark });
    } catch (error: unknown) {
      console.error('Status bar style failed:', this.describe(error));
    }

    try {
      await app.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack && !this.isRootPath()) {
          this.location.back();
          return;
        }
        void app.exitApp().catch((error: unknown) => {
          console.error('exitApp failed:', this.describe(error));
        });
      });
    } catch (error: unknown) {
      console.error('Back button listener failed:', this.describe(error));
    }
  }

  private isRootPath(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return ROOT_PATHS.has(path);
  }

  private describe(error: unknown): string | unknown {
    return error instanceof Error ? error.message : error;
  }
}
