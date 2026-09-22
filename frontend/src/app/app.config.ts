import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { impersonationInterceptor } from './core/interceptors/impersonation.interceptor';
import { loggingInterceptor } from './core/interceptors/logging.interceptor';
import { TOKEN_KEYS } from './core/auth/auth';
import { BIOMETRIC_LOCK_KEY, BIOMETRIC_LOGIN_KEY } from './core/auth/biometric-lock';
import { TokenStorage } from './core/storage/token-storage';
import { NativeShell } from './core/native/native-shell';
import { AppErrorHandler } from './core/logging/error-handler';
import { PosthogService } from './core/analytics/posthog.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // Load persisted tokens from native secure storage before anything reads auth state.
    provideAppInitializer(() =>
      inject(TokenStorage).hydrate([
        ...Object.values(TOKEN_KEYS),
        BIOMETRIC_LOCK_KEY,
        BIOMETRIC_LOGIN_KEY,
      ]),
    ),
    // No-ops when disabled/unconfigured (see environment.*.ts). Fire-and-forget: must never delay bootstrap.
    provideAppInitializer(() => {
      inject(PosthogService).init();
    }),
    // Status bar style + Android back button. Fire-and-forget: it must never delay or fail bootstrap.
    provideAppInitializer(() => {
      void inject(NativeShell).init();
    }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor, impersonationInterceptor, loggingInterceptor]),
    ),
  ],
};
