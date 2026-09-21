import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { impersonationInterceptor } from './core/interceptors/impersonation.interceptor';
import { TOKEN_KEYS } from './core/auth/auth';
import { TokenStorage } from './core/storage/token-storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Load persisted tokens from native secure storage before anything reads auth state.
    provideAppInitializer(() => inject(TokenStorage).hydrate(Object.values(TOKEN_KEYS))),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, impersonationInterceptor])),
  ],
};
