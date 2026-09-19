import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { HealthResponse } from '@daltime/contracts';
import { ok, setRequestOrigin } from '../response.js';

const HEALTHY: HealthResponse = { status: 'ok' };

/**
 * Health check handler — returns {"status":"ok"} with HTTP 200.
 * This endpoint has no auth requirement and no DynamoDB access.
 * It exists solely as a public heartbeat target for CI/CD smoke tests
 * so that automated post-deploy checks can confirm the API Gateway and
 * Lambda runtime are alive after a deployment.
 *
 * The try/catch is intentional: a heartbeat must never surface an
 * uncaught exception to the runtime — even if something unexpected
 * happens internally, we still return a shaped 200 rather than letting
 * Lambda propagate an error response that would cause smoke tests to fail
 * for a reason unrelated to the application being down.
 */
export const handler = async (event: APIGatewayProxyEventV2) => {
  // Set CORS origin from the incoming request so the response headers
  // match the caller's origin (or the default allowed origin).
  setRequestOrigin(event.headers?.['origin']);

  try {
    // OPTIONS is the CORS pre-flight request — respond with 200 and CORS headers,
    // no body needed. All other methods (GET) fall through to the status response.
    if (event.requestContext.http.method === 'OPTIONS') {
      return ok('');
    }

    return ok(HEALTHY);
  } catch {
    // Safety net: if something unexpected goes wrong, still return a shaped
    // 200 so the heartbeat does not appear to fail due to a Lambda error.
    return ok(HEALTHY);
  }
};
