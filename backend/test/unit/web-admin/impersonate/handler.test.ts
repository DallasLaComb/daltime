import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';

// Generic-dispatch coverage: rather than mocking per-route *Proxy service
// functions (the old whitelist approach), these tests mock the *real* role
// handler modules that route-registry.ts dynamically imports, and assert
// the impersonate handler forwards to them with the impersonated userId
// substituted for the caller's identity — proving the dispatch mechanism
// itself is generic, not the specific routes it happens to cover.

const managerShiftsHandler = vi.fn();
const employeeProfileHandler = vi.fn();
const notificationsHandler = vi.fn();
const orgAdminShiftsHandler = vi.fn();

vi.mock('../../../../src/functions/manager/shifts/handler.js', () => ({
  handler: managerShiftsHandler,
}));
vi.mock('../../../../src/functions/employee/profile/handler.js', () => ({
  handler: employeeProfileHandler,
}));
vi.mock('../../../../src/functions/shared/notifications/handler.js', () => ({
  handler: notificationsHandler,
}));
vi.mock('../../../../src/functions/org-admin/shifts/handler.js', () => ({
  handler: orgAdminShiftsHandler,
}));

vi.mock('../../../../src/functions/web-admin/impersonate/service.js', () => ({
  listImpersonatableUsers: vi.fn(),
  getUserContext: vi.fn(),
}));

vi.mock('../../../../src/functions/web-admin/impersonate/db.js', () => ({
  getUserReverseLookup: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {},
  AdminListGroupsForUserCommand: class {},
}));

// Mock requireWebAdminWithLookup so handler tests don't need a live DynamoDB.
// Default resolves to an ACTIVE WebAdmin caller; individual auth tests override.
vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
  setRequestOrigin: vi.fn(),
}));

import { handler } from '../../../../src/functions/web-admin/impersonate/handler.js';
import { getUserReverseLookup } from '../../../../src/functions/web-admin/impersonate/db.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';

const IMPERSONATED_USER_ID = 'impersonated-user-456';

// The web-admin caller returned by requireWebAdminWithLookup on the happy path.
const mockCaller = {
  sub: 'web-admin-sub-1',
  web_admin_id: 'WADMIN#uuid-test',
  email: 'admin@example.com',
  status: 'ACTIVE' as const,
};

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & {
    method?: string;
    path?: string;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const rawPath = overrides.path ?? `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`;
  return {
    version: '2.0',
    routeKey: `${method} ${rawPath}`,
    rawPath,
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token', origin: 'http://localhost:4200' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { 'cognito:groups': 'WebAdmin', sub: 'web-admin-sub-1' }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-id',
      routeKey: `${method} ${rawPath}`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: { userId: IMPERSONATED_USER_ID },
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: caller is an active WebAdmin with a provisioned DynamoDB record.
  vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
  vi.mocked(getUserReverseLookup).mockResolvedValue({
    PK: `USER#${IMPERSONATED_USER_ID}`,
    SK: 'METADATA',
    org_id: 'org-1',
  });
});

describe('Impersonate generic dispatch — handler.ts', () => {
  it('forwards manager/shifts to the real manager shifts handler with the impersonated sub', async () => {
    managerShiftsHandler.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: JSON.stringify([{ shift_id: 's1' }]),
    });

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([{ shift_id: 's1' }]);
    expect(managerShiftsHandler).toHaveBeenCalledTimes(1);
    const forwardedEvent = managerShiftsHandler.mock.calls[0][0];
    expect(forwardedEvent.requestContext.authorizer.jwt.claims.sub).toBe(IMPERSONATED_USER_ID);
  });

  it('extracts a path param (shiftId) and forwards it to the real handler', async () => {
    managerShiftsHandler.mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' });

    await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts/shift-9`,
      }),
    );

    const forwardedEvent = managerShiftsHandler.mock.calls[0][0];
    expect(forwardedEvent.pathParameters).toEqual({ shiftId: 'shift-9' });
  });

  it('rejects a non-GET request with 403 before resolving or forwarding anything', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts/shift-9`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(body(result).error).toContain('read-only');
    expect(getUserReverseLookup).not.toHaveBeenCalled();
    expect(managerShiftsHandler).not.toHaveBeenCalled();
  });

  it('preserves the acting WebAdmin as RFC 8693 `act_*` claims on the forwarded event', async () => {
    managerShiftsHandler.mockResolvedValue({ statusCode: 200, headers: {}, body: '[]' });

    await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    );

    const forwardedEvent = managerShiftsHandler.mock.calls[0][0];
    expect(forwardedEvent.requestContext.authorizer.jwt.claims['act_sub']).toBe(mockCaller.sub);
    expect(forwardedEvent.requestContext.authorizer.jwt.claims['act_web_admin_id']).toBe(
      mockCaller.web_admin_id,
    );
    // The impersonated user is still the effective subject.
    expect(forwardedEvent.requestContext.authorizer.jwt.claims.sub).toBe(IMPERSONATED_USER_ID);
  });

  it('dispatches notifications routes for any of the three roles through the same shared handler', async () => {
    notificationsHandler.mockResolvedValue({ statusCode: 200, headers: {}, body: '[]' });

    await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/employee/notifications`,
      }),
    );

    expect(notificationsHandler).toHaveBeenCalledTimes(1);
  });

  it('reaches a previously-uncovered route (org-admin/shifts) with zero feature-specific handler code', async () => {
    orgAdminShiftsHandler.mockResolvedValue({ statusCode: 200, headers: {}, body: '[]' });

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/org-admin/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(orgAdminShiftsHandler).toHaveBeenCalledTimes(1);
  });

  it('returns 404 without invoking any real handler if the impersonated user does not exist', async () => {
    vi.mocked(getUserReverseLookup).mockResolvedValue(null);

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
    expect(managerShiftsHandler).not.toHaveBeenCalled();
  });

  it('returns 400 for an unroutable path instead of a silent 500', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/does-not-exist`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(body(result).error).toContain('Unhandled proxy route');
  });

  it('OPTIONS short-circuits to 200 without resolving any route', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'OPTIONS',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(getUserReverseLookup).not.toHaveBeenCalled();
  });

  it('returns 400 when the userId path parameter is missing entirely', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: '/web-admin/impersonate//manager/shifts',
        pathParameters: {},
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(body(result).error).toContain('userId path parameter is required');
  });

  // ── Authorization: data-driven WebAdmin gate ────────────────────────────

  it('(a) returns 403 and never resolves the target user when the caller is not in the WebAdmin group', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(getUserReverseLookup).not.toHaveBeenCalled();
    expect(managerShiftsHandler).not.toHaveBeenCalled();
  });

  it('(b) returns 403 when the caller is in the WebAdmin group but has no DynamoDB record', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin record not found'));

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(body(result).error).toContain('WebAdmin record not found');
    expect(getUserReverseLookup).not.toHaveBeenCalled();
    expect(managerShiftsHandler).not.toHaveBeenCalled();
  });

  it('(c) returns 403 when the caller has a DynamoDB record but is DISABLED', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin account is disabled'));

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(body(result).error).toContain('WebAdmin account is disabled');
    expect(getUserReverseLookup).not.toHaveBeenCalled();
    expect(managerShiftsHandler).not.toHaveBeenCalled();
  });

  it('(d) proceeds normally when the caller is an ACTIVE WebAdmin with a valid DynamoDB record', async () => {
    managerShiftsHandler.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: JSON.stringify([{ shift_id: 'happy-path' }]),
    });

    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(requireWebAdminWithLookup).toHaveBeenCalledTimes(1);
    expect(managerShiftsHandler).toHaveBeenCalledTimes(1);
  });

  it('OPTIONS short-circuits before requireWebAdminWithLookup would even run', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'OPTIONS',
        path: `/web-admin/impersonate/${IMPERSONATED_USER_ID}/manager/shifts`,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
  });
});
