import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { internalError, ok, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { listEmployees } from './service.js';
import type { WebAdminEmployeeListResponse } from '@daltime/contracts';
import { withLogging } from '../../shared/with-logging.js';

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: verify the caller is in the WebAdmin Cognito group AND has
    // a provisioned, ACTIVE WebAdmin record in DynamoDB before any query is
    // allowed. This handler is read-only so web_admin_id is not threaded into
    // the service call, but the identity check still applies.
    await requireWebAdminWithLookup(event);

    if (method === 'GET') {
      return ok<WebAdminEmployeeListResponse>(await listEmployees());
    }

    return internalError(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (error) {
    return mapHandlerError(error, 'web-admin employees handler');
  }
};

export const handler = withLogging(handleRequest, 'web-admin-employees');
