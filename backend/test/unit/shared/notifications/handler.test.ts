import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../../src/functions/shared/notifications/service.js', () => ({
  listNotifications: vi.fn(),
  markOneAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}));

import { MarkOneNotificationPathParams, type NotificationResponse } from '@daltime/contracts';
import { contractErrorMessage } from '../../helpers/contract-error.js';
import { handler } from '../../../../src/functions/shared/notifications/handler.js';
import { NotFoundError } from '../../../../src/functions/shared/errors.js';
import {
  listNotifications,
  markOneAsRead,
  markAllAsRead,
} from '../../../../src/functions/shared/notifications/service.js';

// ─── Factory ─────────────────────────────────────────────────────────────────

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /manager/notifications`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/manager/notifications',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token', origin: 'http://localhost:4200' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { sub: 'caller-sub-123' }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/manager/notifications',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-id',
      routeKey,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: {},
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const mockNotification: NotificationResponse = {
  notification_id: '2025-01-01T00:00:00.000Z#raw-id-1',
  recipient_sub: 'caller-sub-123',
  type: 'INFO',
  message: 'hello',
  read: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

beforeEach(() => vi.resetAllMocks());

// ─── OPTIONS ─────────────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200 without invoking getCallerSub / any service call', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /manager/notifications' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('returns 200 for the {notificationId} OPTIONS event too', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'OPTIONS',
        routeKey: 'OPTIONS /manager/notifications/{notificationId}',
        pathParameters: { notificationId: 'whatever' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /{role}/notifications — list ─────────────────────────────────────────

describe('GET /{role}/notifications — list', () => {
  it('returns 200 with the array from the service, scoped by caller sub', async () => {
    vi.mocked(listNotifications).mockResolvedValue([mockNotification]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockNotification]);
    expect(listNotifications).toHaveBeenCalledWith('caller-sub-123');
  });

  it('returns 200 with [] for the empty state', async () => {
    vi.mocked(listNotifications).mockResolvedValue([]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([]);
  });

  it('returns 500 when the service throws an unexpected error', async () => {
    vi.mocked(listNotifications).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });

  it('resolves callerSub from the JWT-decoded Authorization header when authorizer claims are absent (SAM local path)', async () => {
    vi.mocked(listNotifications).mockResolvedValue([]);
    const fakeJwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: 'local-sub-999' })).toString('base64url')}.sig`;
    const result = (await handler(
      buildApiGwEvent({
        headers: { authorization: `Bearer ${fakeJwt}` },
        requestContext: {
          ...buildApiGwEvent().requestContext,
          authorizer: { jwt: { claims: {}, scopes: null } },
        },
      } as unknown as Partial<APIGatewayProxyEventV2WithJWTAuthorizer>),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(listNotifications).toHaveBeenCalledWith('local-sub-999');
  });
});

// ─── PATCH /{role}/notifications — mark all read ──────────────────────────────

describe('PATCH /{role}/notifications — mark all read', () => {
  it('returns 200 with { success: true, marked_count } and calls markAllAsRead with callerSub, not markOneAsRead', async () => {
    vi.mocked(markAllAsRead).mockResolvedValue(3);
    const result = (await handler(
      buildApiGwEvent({ method: 'PATCH', routeKey: 'PATCH /manager/notifications' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual({ success: true, marked_count: 3 });
    expect(markAllAsRead).toHaveBeenCalledWith('caller-sub-123');
    expect(markOneAsRead).not.toHaveBeenCalled();
  });

  it('returns 500 when markAllAsRead throws', async () => {
    vi.mocked(markAllAsRead).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({ method: 'PATCH', routeKey: 'PATCH /manager/notifications' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PATCH /{role}/notifications/{notificationId} — mark one read ────────────

describe('PATCH /{role}/notifications/{notificationId} — mark one read', () => {
  it('returns 200 with the updated notification when owned', async () => {
    vi.mocked(markOneAsRead).mockResolvedValue({ ...mockNotification, read: true });
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: mockNotification.notification_id },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual({ ...mockNotification, read: true });
    expect(markOneAsRead).toHaveBeenCalledWith('caller-sub-123', mockNotification.notification_id);
    expect(markAllAsRead).not.toHaveBeenCalled();
  });

  it('returns 404, NOT 403, when the notification belongs to another user (no existence leakage)', async () => {
    vi.mocked(markOneAsRead).mockRejectedValue(
      new NotFoundError(`Notification '${mockNotification.notification_id}' not found`),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: mockNotification.notification_id },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(result.statusCode).not.toBe(403);
    expect(body(result)).toEqual({
      error: `Notification '${mockNotification.notification_id}' not found`,
    });
  });

  it('returns 404 for a notificationId that never existed at all', async () => {
    vi.mocked(markOneAsRead).mockRejectedValue(new NotFoundError("Notification 'bogus' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: 'bogus' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
  });

  it('returns 400 for an empty-string notificationId path param instead of falling through to mark-ALL semantics', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: '' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    // notificationId is present (not undefined) but empty, so this is the
    // single-item route with an invalid param — must 400, not silently
    // fall through to mark-all semantics.
    expect(markOneAsRead).not.toHaveBeenCalled();
    expect(markAllAsRead).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({
      error: contractErrorMessage(MarkOneNotificationPathParams, { notificationId: '' }),
    });
  });

  it('returns 500 when markOneAsRead throws an unexpected error', async () => {
    vi.mocked(markOneAsRead).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: mockNotification.notification_id },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });

  it('passes the composite notification_id (containing # and :) through to the service unmangled', async () => {
    vi.mocked(markOneAsRead).mockResolvedValue({ ...mockNotification, read: true });
    const compositeId = '2025-06-18T08:30:00.123Z#abc-def-456';
    await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/notifications/{notificationId}',
        pathParameters: { notificationId: compositeId },
      }),
    );
    expect(markOneAsRead).toHaveBeenCalledWith('caller-sub-123', compositeId);
  });
});

// ─── Role-prefix tampering ──────────────────────────────────────────────────

describe('Role-prefix tampering — confirms no role/group check exists at this layer', () => {
  it('an "employee" JWT hitting /manager/notifications (or any other role prefix) still succeeds, scoped only by sub — proves role authorization is not enforced here, by design or omission', async () => {
    // The handler dispatches purely on HTTP method + presence of {notificationId}.
    // It never reads event.rawPath/routeKey to check which role segment was hit,
    // and never reads a Cognito group/role claim. This test proves that by
    // calling the /manager/notifications route shape with a caller sub that
    // would, in a real deployment, belong to an Employee-group Cognito user —
    // the handler has no way to know or care, and the call succeeds.
    vi.mocked(listNotifications).mockResolvedValue([mockNotification]);
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/notifications',
        requestContext: {
          ...buildApiGwEvent().requestContext,
          authorizer: { jwt: { claims: { sub: 'caller-sub-123', 'cognito:groups': 'Employee' }, scopes: null } },
        },
      } as unknown as Partial<APIGatewayProxyEventV2WithJWTAuthorizer>),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listNotifications).toHaveBeenCalledWith('caller-sub-123');
    // No mechanism in this handler ever inspects rawPath/routeKey for a role
    // segment, and no role/group claim is ever read — confirmed by code read
    // of handler.ts/service.ts/db.ts in addition to this passing test.
  });

  it('an unauthenticated-looking event (no sub resolvable) still reaches the service with an empty-string callerSub rather than being rejected at this layer', async () => {
    // getCallerSub() returns '' when neither JWT claims nor a decodable
    // Authorization header are present — the handler does not itself
    // validate that callerSub is non-empty before calling the service.
    vi.mocked(listNotifications).mockResolvedValue([]);
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        headers: {},
        requestContext: {
          ...buildApiGwEvent().requestContext,
          authorizer: { jwt: { claims: {}, scopes: null } },
        },
      } as unknown as Partial<APIGatewayProxyEventV2WithJWTAuthorizer>),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listNotifications).toHaveBeenCalledWith('');
    // In production, API Gateway's JWT authorizer would already have rejected
    // an unauthenticated request before Lambda is invoked (DefaultAuthorizer:
    // CognitoJwtAuthorizer on the HttpApi, confirmed in infra/template.yaml),
    // so this path is theoretical for prod traffic but is exactly what SAM
    // local / a misconfigured authorizer would let through unchecked.
  });
});

// ─── Unhandled routes ──────────────────────────────────────────────────────

describe('Unhandled method', () => {
  it('returns 400 for an unsupported HTTP method on the notifications route', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'DELETE', routeKey: 'DELETE /manager/notifications' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result).error).toContain('Unhandled route');
  });

  it('returns 400 for POST (createNotification has no HTTP route)', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/notifications' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });
});
