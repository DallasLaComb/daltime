import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../services/impersonation.service';

/**
 * When the web-admin is impersonating another user, this interceptor rewrites
 * role-prefixed API URLs so they are routed through the web-admin proxy:
 *
 *   /org-admin/...  →  /web-admin/impersonate/{userId}/org-admin/...
 *   /manager/...    →  /web-admin/impersonate/{userId}/manager/...
 *   /employee/...   →  /web-admin/impersonate/{userId}/employee/...
 *
 * This keeps existing components and services unchanged — they call their
 * normal endpoints and the interceptor transparently rewrites the path.
 *
 * Phase 2 of the impersonation redesign (contracts/checklist.md §11): the request
 * ALSO carries `X-Impersonate-User: {userId}`, the header the contract now declares
 * on every role operation. The backend ignores it for now — the URL rewrite is still
 * what routes the call — so both transports run in parallel until the phase 3 cutover
 * removes the rewrite.
 *
 * Registered AFTER authInterceptor so both the Authorization header and
 * the rewritten URL are present on the same request.
 */

/** Must match the `x-impersonate-user` header declared by `ImpersonationHeader` in the contract. */
const IMPERSONATE_HEADER = 'X-Impersonate-User';

const ROLE_PREFIXES = ['/org-admin/', '/manager/', '/employee/'] as const;

export const impersonationInterceptor: HttpInterceptorFn = (req, next) => {
  // Only intercept requests to our own API.
  if (!req.url.startsWith(environment.api.baseUrl)) {
    return next(req);
  }

  const viewingAs = inject(ImpersonationService).viewingAs();
  if (!viewingAs) {
    return next(req);
  }

  const path = req.url.slice(environment.api.baseUrl.length); // e.g. "/manager/shifts-needed"

  const matchedPrefix = ROLE_PREFIXES.find((prefix) => path.startsWith(prefix));
  if (!matchedPrefix) {
    return next(req);
  }

  const proxyUrl = `${environment.api.baseUrl}/web-admin/impersonate/${viewingAs.userId}${path}`;

  return next(
    req.clone({
      url: proxyUrl,
      setHeaders: { [IMPERSONATE_HEADER]: viewingAs.userId },
    }),
  );
};
