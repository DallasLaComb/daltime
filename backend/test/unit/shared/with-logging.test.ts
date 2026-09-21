import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';

vi.mock('../../../src/functions/shared/logger.js', () => ({
  logger: {
    addContext: vi.fn(),
    appendKeys: vi.fn(),
    resetKeys: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  serializeError: vi.fn((err: unknown) =>
    err instanceof Error ? { name: err.name, message: err.message } : { error: String(err) },
  ),
}));

import { withLogging } from '../../../src/functions/shared/with-logging.js';
import { logger } from '../../../src/functions/shared/logger.js';

const FAKE_CONTEXT = {
  functionName: 'test-fn',
  awsRequestId: 'ctx-req-id',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:test-fn',
  memoryLimitInMB: '128',
  functionVersion: '$LATEST',
  logGroupName: '/aws/lambda/test-fn',
  logStreamName: '2026/01/01/[$LATEST]abc',
  getRemainingTimeInMillis: () => 30000,
} as unknown as Context;

function buildEvent(overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> = {}): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /employee/profile',
    rawPath: '/employee/profile',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api-1',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method: 'GET', path: '/employee/profile', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: '' },
      requestId: 'gw-req-1',
      routeKey: 'GET /employee/profile',
      stage: '$default',
      time: '',
      timeEpoch: 0,
      authorizer: { jwt: { claims: { sub: 'user-sub-1', 'cognito:groups': 'Employee' }, scopes: '' } },
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const okResponse: APIGatewayProxyResultV2 = { statusCode: 200, body: 'ok' };
const inner = vi.fn(async (_e: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => okResponse);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('withLogging', () => {
  it('returns the inner handler result unchanged', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    const result = await wrapped(buildEvent(), FAKE_CONTEXT);
    expect(result).toBe(okResponse);
  });

  it('logs "request completed" with status 200 and a duration_ms on success', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({ status: 200, duration_ms: expect.any(Number) }),
    );
  });

  it('uses the X-Correlation-Id header when present', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent({ headers: { 'x-correlation-id': 'client-corr-id' } }), FAKE_CONTEXT);

    expect(vi.mocked(logger.appendKeys)).toHaveBeenCalledWith(
      expect.objectContaining({ correlation_id: 'client-corr-id' }),
    );
  });

  it('falls back to the API Gateway request id when the correlation header is absent', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);

    expect(vi.mocked(logger.appendKeys)).toHaveBeenCalledWith(
      expect.objectContaining({ correlation_id: 'gw-req-1', request_id: 'gw-req-1' }),
    );
  });

  it('appends caller_sub and caller_role from JWT claims', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);

    expect(vi.mocked(logger.appendKeys)).toHaveBeenCalledWith(
      expect.objectContaining({ caller_sub: 'user-sub-1', caller_role: 'Employee' }),
    );
  });

  it('appends handler name to keys', async () => {
    const wrapped = withLogging(inner, 'my-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);

    expect(vi.mocked(logger.appendKeys)).toHaveBeenCalledWith(
      expect.objectContaining({ handler: 'my-handler' }),
    );
  });

  it('calls resetKeys in finally even when the inner handler succeeds', async () => {
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);
    expect(vi.mocked(logger.resetKeys)).toHaveBeenCalledOnce();
  });

  it('calls resetKeys in finally when the inner handler throws', async () => {
    inner.mockRejectedValueOnce(new Error('exploded'));
    const wrapped = withLogging(inner, 'test-handler');
    await expect(wrapped(buildEvent(), FAKE_CONTEXT)).rejects.toThrow('exploded');
    expect(vi.mocked(logger.resetKeys)).toHaveBeenCalledOnce();
  });

  it('logs status 500 and rethrows when inner throws', async () => {
    inner.mockRejectedValueOnce(new Error('boom'));
    const wrapped = withLogging(inner, 'test-handler');
    await expect(wrapped(buildEvent(), FAKE_CONTEXT)).rejects.toThrow('boom');

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({ status: 500 }),
    );
  });

  it('logs the correct statusCode from a non-200 response', async () => {
    inner.mockResolvedValueOnce({ statusCode: 404, body: 'not found' });
    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(buildEvent(), FAKE_CONTEXT);

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({ status: 404 }),
    );
  });

  it('omits caller_sub and caller_role when the event has no JWT claims', async () => {
    const event = buildEvent();
    // Remove authorizer claims entirely (OPTIONS-style)
    (event.requestContext as Record<string, unknown>)['authorizer'] = undefined;
    event.headers = {};

    const wrapped = withLogging(inner, 'test-handler');
    await wrapped(event, FAKE_CONTEXT);

    const appendCall = vi.mocked(logger.appendKeys).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(appendCall?.['caller_sub']).toBeUndefined();
    expect(appendCall?.['caller_role']).toBeUndefined();
  });
});
