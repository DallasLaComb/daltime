import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { detectPlatform } from '../logging/client-context';
import { LoggerService } from '../logging/logger.service';

/**
 * Adds `X-Correlation-Id` (client-generated, joins this request's backend logs to any client log
 * entry about it) and `X-Platform` (lets the backend's UA parser correctly classify a Capacitor
 * WebView, which reports as a desktop browser UA otherwise — see `shared/ua-context.ts`) to every
 * API request, and logs failed calls (4xx/5xx) once via `LoggerService`. Registered last so it still
 * sees the final request but never touches auth/impersonation headers.
 */
export const loggingInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.api.baseUrl)) {
    return next(req);
  }

  const correlationId = crypto.randomUUID();
  const withHeaders = req.clone({
    setHeaders: {
      'X-Correlation-Id': correlationId,
      'X-Platform': detectPlatform(),
    },
  });

  const logger = inject(LoggerService);
  const path = req.url.slice(environment.api.baseUrl.length).split('?')[0];

  return next(withHeaders).pipe(
    catchError((err: unknown) => {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status >= 400) {
        logger.logHttpFailure(req.method, path, status, correlationId);
      }
      return throwError(() => err);
    }),
  );
};
