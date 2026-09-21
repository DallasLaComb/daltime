import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../../src/functions/shared/client-logs/service.js', () => ({
  processClientLogs: vi.fn(),
}));

import { handler } from '../../../../src/functions/shared/client-logs/handler.js';
import { processClientLogs } from '../../../../src/functions/shared/client-logs/service.js';

const mockProcessClientLogs = processClientLogs as ReturnType<typeof vi.fn>;

function buildEvent(
  method: string,
  body?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: `${method} /shared/client-logs`,
    rawPath: '/shared/client-logs',
    rawQueryString: '',
    headers: { origin: 'https://dev.daltime.com', 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: {
          claims: { sub: 'user-sub-123', 'cognito:groups': 'employee' },
          scopes: null,
        },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/shared/client-logs',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test',
      },
      requestId: 'test-req-id',
      routeKey: `${method} /shared/client-logs`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    isBase64Encoded: false,
    body: body ?? null,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function statusCode(result: unknown): number {
  return (result as APIGatewayProxyStructuredResultV2).statusCode ?? 200;
}

const validBatch = {
  context: {
    client_session_id: 'sess-abc',
    platform: 'web',
    device_type: 'desktop',
    os: 'macos',
    browser: 'Chrome/126',
  },
  entries: [
    {
      type: 'log',
      level: 'info',
      ts: '2026-09-21T00:00:00.000Z',
      seq: 1,
      message: 'test message',
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('shared/client-logs handler', () => {
  it('returns 204 for a valid batch', async () => {
    const result = await handler(buildEvent('POST', JSON.stringify(validBatch)));
    expect(statusCode(result)).toBe(204);
    expect(mockProcessClientLogs).toHaveBeenCalledOnce();
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const result = await handler(buildEvent('OPTIONS'));
    expect(statusCode(result)).toBe(200);
    expect(mockProcessClientLogs).not.toHaveBeenCalled();
  });

  it('returns 400 when body is missing', async () => {
    const result = await handler(buildEvent('POST'));
    expect(statusCode(result)).toBe(400);
    expect(mockProcessClientLogs).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = await handler(buildEvent('POST', '{not-json}'));
    expect(statusCode(result)).toBe(400);
  });

  it('returns 400 when entries array is empty', async () => {
    const result = await handler(
      buildEvent('POST', JSON.stringify({ ...validBatch, entries: [] })),
    );
    expect(statusCode(result)).toBe(400);
  });

  it('returns 400 when entries exceed 25', async () => {
    const result = await handler(
      buildEvent(
        'POST',
        JSON.stringify({ ...validBatch, entries: Array(26).fill(validBatch.entries[0]) }),
      ),
    );
    expect(statusCode(result)).toBe(400);
  });

  it('returns 400 when context.platform is invalid', async () => {
    const result = await handler(
      buildEvent(
        'POST',
        JSON.stringify({ ...validBatch, context: { ...validBatch.context, platform: 'fax' } }),
      ),
    );
    expect(statusCode(result)).toBe(400);
  });

  it('passes callerSub and callerRole to processClientLogs', async () => {
    await handler(buildEvent('POST', JSON.stringify(validBatch)));
    expect(mockProcessClientLogs).toHaveBeenCalledWith(
      expect.objectContaining({ context: validBatch.context }),
      'user-sub-123',
      'employee',
    );
  });
});
