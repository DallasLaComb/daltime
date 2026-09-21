import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type {
  ManagerScheduleTemplateListResponse,
  ManagerScheduleTemplateResponse,
  ApplyScheduleTemplateResult,
} from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';
import * as service from './service.js';

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);
  const callerSub = getCallerSub(event);

  try {
    // POST /manager/schedule-templates/{templateId}/apply
    if (method === 'POST' && rawPath.endsWith('/apply')) {
      const templateId = event.pathParameters?.['templateId'];
      if (!templateId) return badRequest('templateId is required');
      const body = event.body ? JSON.parse(event.body) : {};
      return ok<ApplyScheduleTemplateResult>(await service.applyTemplate(callerSub, templateId, body));
    }

    // GET /manager/schedule-templates
    if (method === 'GET') {
      return ok<ManagerScheduleTemplateListResponse>(await service.listTemplates(callerSub));
    }

    // POST /manager/schedule-templates
    if (method === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      return ok<ManagerScheduleTemplateResponse>(await service.createTemplate(callerSub, body));
    }

    // PUT /manager/schedule-templates/{templateId}
    if (method === 'PUT') {
      const templateId = event.pathParameters?.['templateId'];
      if (!templateId) return badRequest('templateId is required');
      const body = event.body ? JSON.parse(event.body) : {};
      return ok<ManagerScheduleTemplateResponse>(await service.updateTemplate(callerSub, templateId, body));
    }

    // DELETE /manager/schedule-templates/{templateId}
    if (method === 'DELETE') {
      const templateId = event.pathParameters?.['templateId'];
      if (!templateId) return badRequest('templateId is required');
      await service.removeTemplate(callerSub, templateId);
      return ok('');
    }

    return badRequest(`Unhandled route: ${method} ${rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'manager schedule-templates handler');
  }
};

export const handler = withLogging(withImpersonation(handleRequest), 'manager-schedule-templates');
