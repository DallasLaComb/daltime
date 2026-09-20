import { Injectable, inject, signal } from '@angular/core';
import { catchError, EMPTY, take } from 'rxjs';
import { ApiClient } from '../api/api-client';
import type { UserRole } from '../auth/user-role.model';

const SESSION_KEY = 'daltime_impersonation';

export interface ImpersonateContext {
  userId: string;
  role: Extract<UserRole, 'OrgAdmin' | 'Manager' | 'Employee'>;
  displayName: string;
  email: string;
  orgId: string;
  sessionId: string;
  expiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly api = inject(ApiClient);
  private readonly _viewingAs = signal<ImpersonateContext | null>(null);

  /** Read-only signal — null when not impersonating. */
  readonly viewingAs = this._viewingAs.asReadonly();

  constructor() {
    // Restore from sessionStorage so impersonation survives a page refresh.
    // Discard the stored context if the server-side session has expired.
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const ctx = JSON.parse(stored) as ImpersonateContext;
        if (new Date(ctx.expiresAt) > new Date()) {
          this._viewingAs.set(ctx);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
    } catch {
      // Malformed storage — ignore.
    }
  }

  startImpersonation(ctx: ImpersonateContext): void {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ctx));
    this._viewingAs.set(ctx);
  }

  endImpersonation(): void {
    const ctx = this._viewingAs();
    // Fire-and-forget: clean up the DynamoDB session record. Local state is cleared
    // regardless so the UI is never stuck waiting for the network.
    if (ctx?.sessionId) {
      this.api
        .delete('/web-admin/impersonate/sessions/{sessionId}', {
          params: { sessionId: ctx.sessionId },
        })
        .pipe(take(1), catchError(() => EMPTY))
        .subscribe();
    }
    sessionStorage.removeItem(SESSION_KEY);
    this._viewingAs.set(null);
  }
}
