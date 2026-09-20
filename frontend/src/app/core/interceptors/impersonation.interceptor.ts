import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../services/impersonation.service';

/**
 * While a web-admin is viewing the app as another user, this interceptor adds
 * `X-Impersonate-User: {userId}` to every request for a role route:
 *
 *   GET /manager/shifts   +  X-Impersonate-User: {userId}
 *
 * The URL is NOT rewritten, so the call hits the real, documented, typed route and each
 * role Lambda resolves the header itself (`withImpersonation`, backend `shared/impersonation.ts`):
 * it must come from an ACTIVE WebAdmin, is read-only, and the target must really hold that role.
 * The header name and its contract live in `ImpersonationHeader` (contracts/src/schemas/common.ts).
 *
 * Existing components and services are unchanged — they call their normal endpoints and the
 * interceptor transparently adds the header. Requests outside the role prefixes (the picker
 * under `/web-admin/impersonate/...`, the web-admin's own routes) are left alone.
 *
 * Registered AFTER authInterceptor so both the Authorization header and this one are present
 * on the same request.
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

  if (!ROLE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { [IMPERSONATE_HEADER]: viewingAs.userId } }));
};
