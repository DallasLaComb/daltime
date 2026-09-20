import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ScheduleMonthQuery } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, forbidden, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import {
  generateDraftSchedule,
  publishSchedule,
  getDraftSummary,
  getScheduleMetaForCaller,
} from './service.js';
import type { GenerateDraftScheduleResponse, ManagerScheduleDraftsResponse, PublishScheduleResponse, ScheduleMetaResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);
  if (!callerSub) return forbidden('Missing caller identity');

  try {
    const { month } = parseWithContract(ScheduleMonthQuery, event.queryStringParameters ?? {});

    // POST /manager/schedule/generate
    if (method === 'POST' && rawPath.endsWith('/generate')) {
      return ok<GenerateDraftScheduleResponse>(await generateDraftSchedule(callerSub, month));
    }

    // POST /manager/schedule/publish
    if (method === 'POST' && rawPath.endsWith('/publish')) {
      return ok<PublishScheduleResponse>(await publishSchedule(callerSub, month));
    }

    // GET /manager/schedule/drafts
    if (method === 'GET' && rawPath.endsWith('/drafts')) {
      return ok<ManagerScheduleDraftsResponse>(await getDraftSummary(callerSub, month));
    }

    // GET /manager/schedule/meta
    if (method === 'GET' && rawPath.endsWith('/meta')) {
      return ok<ScheduleMetaResponse>(await getScheduleMetaForCaller(callerSub, month));
    }

    return badRequest(`Unhandled route: ${method} ${rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'manager schedule handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
