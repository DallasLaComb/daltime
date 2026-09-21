import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { logger } from './logger.js';
import { getCallerSub, getCallerGroups } from './auth.js';
import { parseUaContext } from './ua-context.js';

type EventHandler<R> = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<R>;
type LambdaHandler<R> = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context?: Context,
) => Promise<R>;

/**
 * Outermost Lambda wrapper — must be applied after withImpersonation so that 400/403
 * responses produced inside withImpersonation are also logged with caller context.
 *
 * Logs one "request completed" line with status + duration. Correlation id is taken
 * from the inbound X-Correlation-Id header; falls back to the API Gateway request id.
 */
export function withLogging<R extends APIGatewayProxyResultV2>(
  inner: EventHandler<R>,
  name: string,
): LambdaHandler<R> {
  return async (event, context?) => {
    const start = Date.now();
    const method = event.requestContext?.http?.method ?? 'UNKNOWN';
    const route = event.routeKey ?? event.rawPath ?? 'unknown';
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const correlationId = event.headers?.['x-correlation-id'] ?? requestId;

    // addContext needs a real Lambda context; guard so tests with minimal stubs don't crash.
    if (context?.invokedFunctionArn) {
      logger.addContext(context);
    }

    const keys: Record<string, string> = {
      request_id: requestId,
      correlation_id: correlationId,
      route,
      method,
      handler: name,
    };

    const callerSub = getCallerSub(event);
    if (callerSub) keys['caller_sub'] = callerSub;

    const callerGroups = getCallerGroups(event);
    if (callerGroups.length > 0) keys['caller_role'] = callerGroups[0] as string;

    const ua = event.headers?.['user-agent'] ?? '';
    if (ua) {
      const ctx = parseUaContext(ua, event.headers?.['x-platform']);
      keys['device_type'] = ctx.device_type;
      keys['os'] = ctx.os;
      keys['browser'] = ctx.browser;
      keys['platform'] = ctx.platform;
    }

    logger.appendKeys(keys);

    try {
      const result = await inner(event);
      const status =
        result != null && typeof result === 'object' && 'statusCode' in result
          ? ((result as APIGatewayProxyStructuredResultV2).statusCode ?? 200)
          : 200;
      logger.info('request completed', { status, duration_ms: Date.now() - start });
      return result;
    } catch (err) {
      logger.info('request completed', { status: 500, duration_ms: Date.now() - start });
      throw err;
    } finally {
      logger.resetKeys();
    }
  };
}
