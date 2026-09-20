import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type GenerateResult = ApiSchema<'GenerateDraftScheduleResponse'>;
export type PublishResult = ApiSchema<'PublishScheduleResponse'>;
export type ScheduleMeta = ApiSchema<'ScheduleMetaResponse'>;

@Injectable({ providedIn: 'root' })
export class ManagerScheduleService {
  private readonly api = inject(ApiClient);

  getMeta(month: string): Observable<ScheduleMeta> {
    return this.api.get('/manager/schedule/meta', { query: { month } });
  }

  generateDraft(month: string): Observable<GenerateResult> {
    return this.api.post('/manager/schedule/generate', undefined, { query: { month } });
  }

  publish(month: string): Observable<PublishResult> {
    return this.api.post('/manager/schedule/publish', undefined, { query: { month } });
  }
}
