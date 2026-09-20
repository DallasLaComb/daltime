import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';
import type { ImpersonateContext } from '../../../core/services/impersonation.service';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type ImpersonateUserSummary = ApiSchema<'ImpersonateUserSummary'>;
export type ImpersonateContextResponse = ApiSchema<'ImpersonateContextResponse'>;

@Injectable({ providedIn: 'root' })
export class ImpersonateService {
  private readonly api = inject(ApiClient);

  listUsers(orgId: string, role: ImpersonateContext['role']): Observable<ImpersonateUserSummary[]> {
    return this.api.get('/web-admin/impersonate/users', {
      query: { orgId, role },
    });
  }

  /** Fetch user context and map the backend's snake_case fields to camelCase. */
  getContext(userId: string): Observable<ImpersonateContext> {
    return this.api
      .get('/web-admin/impersonate/{userId}/context', { params: { userId } })
      .pipe(
        map((ctx) => ({
          userId: ctx.user_id,
          role: ctx.role,
          displayName: ctx.display_name,
          email: ctx.email,
          orgId: ctx.org_id,
        })),
      );
  }
}
