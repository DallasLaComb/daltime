import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type GenerateDummyDataBody = ApiSchema<'GenerateDummyDataBody'>;
export type GenerateDummyDataResponse = ApiSchema<'GenerateDummyDataResponse'>;

/**
 * Service responsible for calling the generate-dummy-data Lambda.
 * Scoped to the Web-Admin feature; not shared across roles.
 */
@Injectable({ providedIn: 'root' })
export class GenerateDummyDataService {
  private readonly api = inject(ApiClient);

  /**
   * Calls POST /web-admin/generate-dummy-data with the selected year and month.
   * Returns an observable that emits the backend's success message on 200 or
   * errors with an HttpErrorResponse on non-2xx.
   */
  generate(body: GenerateDummyDataBody): Observable<GenerateDummyDataResponse> {
    return this.api.post('/web-admin/generate-dummy-data', body);
  }
}
