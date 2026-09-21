import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

export type ScheduleTemplate = ApiSchema<'ManagerScheduleTemplateResponse'>;
export type CreateScheduleTemplateBody = ApiSchema<'CreateScheduleTemplateBody'>;
export type UpdateScheduleTemplateBody = ApiSchema<'UpdateScheduleTemplateBody'>;
export type ApplyScheduleTemplateBody = ApiSchema<'ApplyScheduleTemplateBody'>;
export type ApplyScheduleTemplateResult = ApiSchema<'ApplyScheduleTemplateResult'>;

@Injectable({ providedIn: 'root' })
export class ScheduleTemplatesService {
  private readonly api = inject(ApiClient);

  list(): Observable<ScheduleTemplate[]> {
    return this.api.get('/manager/schedule-templates');
  }

  create(body: CreateScheduleTemplateBody): Observable<ScheduleTemplate> {
    return this.api.post('/manager/schedule-templates', body);
  }

  update(templateId: string, body: UpdateScheduleTemplateBody): Observable<ScheduleTemplate> {
    return this.api.put('/manager/schedule-templates/{templateId}', body, {
      params: { templateId },
    });
  }

  remove(templateId: string): Observable<void> {
    return this.api.delete('/manager/schedule-templates/{templateId}', {
      params: { templateId },
    });
  }

  apply(templateId: string, body: ApplyScheduleTemplateBody): Observable<ApplyScheduleTemplateResult> {
    return this.api.post('/manager/schedule-templates/{templateId}/apply', body, {
      params: { templateId },
    });
  }
}
