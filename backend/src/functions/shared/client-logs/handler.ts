import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { getCallerSub, getCallerGroups } from '../auth.js';
import { ok, noContent, setRequestOrigin } from '../response.js';
import { mapHandlerError } from '../errors.js';
import { parseBody } from '../response.js';
import { parseWithContract } from '../contract-validation.js';
import { withLogging } from '../with-logging.js';
import { ClientLogBatch } from '@daltime/contracts';
import { processClientLogs } from './service.js';

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  setRequestOrigin(event.headers?.['origin']);

  if (method === 'OPTIONS') return ok('');

  const callerSub = getCallerSub(event);
  const callerRole = getCallerGroups(event)[0] ?? 'unknown';

  const parsed = parseBody<unknown>(event.body);
  if (!parsed.ok) return parsed.response;

  try {
    const batch = parseWithContract(ClientLogBatch, parsed.data);
    processClientLogs(batch, callerSub, callerRole);
    return noContent();
  } catch (err) {
    return mapHandlerError(err, 'shared client-logs handler');
  }
};

export const handler = withLogging(handleRequest, 'shared-client-logs');
