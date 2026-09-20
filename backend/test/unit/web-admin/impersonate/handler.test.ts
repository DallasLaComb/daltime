import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ImpersonateUsersQueryParams } from '@daltime/contracts';
import { ForbiddenError, NotFoundError } from '../../../../src/functions/shared/errors.js';
import { contractErrorMessage } from '../../helpers/contract-error.js';

// The impersonate Lambda is only the PICKER now (list users, describe one user). Acting as a
// user is `withImpersonation` in every role Lambda — see test/unit/shared/impersonation.test.ts.

vi.mock('../../../../src/functions/web-admin/impersonate/service.js', () => ({
  listImpersonatableUsers: vi.fn(),
  getUserContext: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {},
  AdminListGroupsForUserCommand: class {},
}));

// Mock the guard so handler tests don't need a live DynamoDB. Default resolves to an ACTIVE
// WebAdmin; individual auth tests override it.
vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
}));

vi.mock('../../../../src/functions/web-admin/impersonate/db.js', () => ({
  isRoleMember: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));

import { handler } from '../../../../src/functions/web-admin/impersonate/handler.js';
import {
  listImpersonatableUsers,
  getUserContext,
} from '../../../../src/functions/web-admin/impersonate/service.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';
import {
  isRoleMember,
  createSession,
  deleteSession,
} from '../../../../src/functions/web-admin/impersonate/db.js';

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
  const rawPath = overrides.path ?? '/web-admin/impersonate/users';
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
    pathParameters: {},
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

const call = async (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  (await handler(e)) as APIGatewayProxyStructuredResultV2;

const MOCK_SESSION = {
  session_id: 'sess-xyz-456',
  actor_sub: mockCaller.sub,
  actor_web_admin_id: mockCaller.web_admin_id,
  target_user_id: 'u1',
  role: 'Manager' as const,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  ttl: Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 1000),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
  vi.mocked(isRoleMember).mockResolvedValue(true);
  vi.mocked(createSession).mockResolvedValue(MOCK_SESSION);
  vi.mocked(deleteSession).mockResolvedValue(undefined);
});

// ─── GET /web-admin/impersonate/users ─────────────────────────────────────────

describe('GET /web-admin/impersonate/users', () => {
  const USERS = [
    { user_id: 'u1', display_name: 'Ann', email: 'a@x.dev', status: 'CONFIRMED', org_id: 'org-1' },
  ];

  it('lists the users for the org + role from the query, validated by the contract', async () => {
    vi.mocked(listImpersonatableUsers).mockResolvedValue(USERS);

    const result = await call(
      buildApiGwEvent({ queryStringParameters: { orgId: 'org-1', role: 'Manager' } }),
    );

    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(USERS);
    expect(listImpersonatableUsers).toHaveBeenCalledWith('org-1', 'Manager');
  });

  it.each([
    ['missing orgId', { role: 'Manager' }],
    ['unknown role', { orgId: 'org-1', role: 'WebAdmin' }],
    ['no params', {}],
  ])('400 from the contract for %s, without reaching the service', async (_label, query) => {
    const result = await call(buildApiGwEvent({ queryStringParameters: query }));

    expect(result.statusCode).toBe(400);
    expect(body(result).error).toBe(contractErrorMessage(ImpersonateUsersQueryParams, query));
    expect(listImpersonatableUsers).not.toHaveBeenCalled();
  });
});

// ─── GET /web-admin/impersonate/{userId}/context ──────────────────────────────

describe('GET /web-admin/impersonate/{userId}/context', () => {
  const CONTEXT = {
    user_id: 'u1',
    role: 'Manager' as const,
    display_name: 'Ann',
    email: 'a@x.dev',
    org_id: 'org-1',
    status: 'CONFIRMED',
  };
  const contextEvent = (pathParameters: Record<string, string>) =>
    buildApiGwEvent({ path: '/web-admin/impersonate/u1/context', pathParameters });

  it('returns the user context for the userId path parameter', async () => {
    vi.mocked(getUserContext).mockResolvedValue(CONTEXT);

    const result = await call(contextEvent({ userId: 'u1' }));

    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(CONTEXT);
    expect(vi.mocked(getUserContext).mock.calls[0]![0]).toBe('u1');
  });

  it('400 when the userId path parameter is missing', async () => {
    const result = await call(contextEvent({}));
    expect(result.statusCode).toBe(400);
    expect(getUserContext).not.toHaveBeenCalled();
  });

  it('404 when the user does not exist', async () => {
    vi.mocked(getUserContext).mockRejectedValue(new NotFoundError('User not found'));
    const result = await call(contextEvent({ userId: 'ghost' }));
    expect(result.statusCode).toBe(404);
  });
});

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('routing', () => {
  it('OPTIONS short-circuits to 200 without running the auth guard', async () => {
    const result = await call(buildApiGwEvent({ method: 'OPTIONS' }));
    expect(result.statusCode).toBe(200);
    expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['the old proxy shape', 'GET', '/web-admin/impersonate/u1/manager/shifts'],
    ['a non-GET on /users', 'POST', '/web-admin/impersonate/users'],
    ['a non-GET on /context', 'DELETE', '/web-admin/impersonate/u1/context'],
  ])('400 for %s — there is no longer any way to act as a user through this Lambda', async (_l, method, path) => {
    const result = await call(buildApiGwEvent({ method, path }));
    expect(result.statusCode).toBe(400);
    expect(body(result).error).toMatch(/Unhandled route/);
    expect(listImpersonatableUsers).not.toHaveBeenCalled();
    expect(getUserContext).not.toHaveBeenCalled();
  });
});

// ─── Authorization: data-driven WebAdmin gate ─────────────────────────────────

describe('authorization', () => {
  it.each([
    ['(a) the caller is not in the WebAdmin group', 'WebAdmin role required'],
    ['(b) the caller has no DynamoDB record', 'WebAdmin record not found'],
    ['(c) the caller is DISABLED', 'WebAdmin account is disabled'],
  ])('403 and no data touched when %s', async (_label, message) => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError(message));

    const users = await call(
      buildApiGwEvent({ queryStringParameters: { orgId: 'org-1', role: 'Manager' } }),
    );
    const context = await call(
      buildApiGwEvent({ path: '/web-admin/impersonate/u1/context', pathParameters: { userId: 'u1' } }),
    );

    for (const result of [users, context]) {
      expect(result.statusCode).toBe(403);
      expect(body(result).error).toContain(message);
    }
    expect(listImpersonatableUsers).not.toHaveBeenCalled();
    expect(getUserContext).not.toHaveBeenCalled();
  });

  it('proceeds for an ACTIVE WebAdmin with a provisioned record', async () => {
    vi.mocked(listImpersonatableUsers).mockResolvedValue([]);
    const result = await call(
      buildApiGwEvent({ queryStringParameters: { orgId: 'org-1', role: 'Employee' } }),
    );
    expect(result.statusCode).toBe(200);
    expect(requireWebAdminWithLookup).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /web-admin/impersonate/sessions ────────────────────────────────────

describe('POST /web-admin/impersonate/sessions', () => {
  const startEvent = (body: unknown) =>
    buildApiGwEvent({
      method: 'POST',
      path: '/web-admin/impersonate/sessions',
      body: JSON.stringify(body),
    });

  it('201 with session_id and expires_at when the target is a valid role member', async () => {
    const result = await call(startEvent({ target_user_id: 'u1', role: 'Manager' }));

    expect(result.statusCode).toBe(201);
    expect(body(result)).toMatchObject({
      session_id: MOCK_SESSION.session_id,
      target_user_id: 'u1',
      role: 'Manager',
      expires_at: MOCK_SESSION.expires_at,
    });
    expect(isRoleMember).toHaveBeenCalledWith('u1', 'Manager');
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ sub: mockCaller.sub }),
      'u1',
      'Manager',
    );
  });

  it('400 from the contract for an unknown role', async () => {
    const result = await call(startEvent({ target_user_id: 'u1', role: 'WebAdmin' }));
    expect(result.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('400 from the contract when target_user_id is missing', async () => {
    const result = await call(startEvent({ role: 'Manager' }));
    expect(result.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('400 when the target is not a member of the requested role', async () => {
    vi.mocked(isRoleMember).mockResolvedValue(false);
    const result = await call(startEvent({ target_user_id: 'u1', role: 'Manager' }));
    expect(result.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('400 when the request body is not valid JSON', async () => {
    const result = await call(
      buildApiGwEvent({ method: 'POST', path: '/web-admin/impersonate/sessions', body: 'not-json' }),
    );
    expect(result.statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('403 when the caller is not an ACTIVE WebAdmin', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));
    const result = await call(startEvent({ target_user_id: 'u1', role: 'Manager' }));
    expect(result.statusCode).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });
});

// ─── DELETE /web-admin/impersonate/sessions/{sessionId} ──────────────────────

describe('DELETE /web-admin/impersonate/sessions/{sessionId}', () => {
  const endEvent = (sessionId?: string) =>
    buildApiGwEvent({
      method: 'DELETE',
      path: `/web-admin/impersonate/sessions/${sessionId ?? 'sess-xyz-456'}`,
      pathParameters: sessionId !== undefined ? { sessionId } : {},
    });

  it('204 on success — deletes the session keyed by actor_sub', async () => {
    const result = await call(endEvent('sess-xyz-456'));
    expect(result.statusCode).toBe(204);
    expect(deleteSession).toHaveBeenCalledWith(mockCaller.sub);
  });

  it('204 even when the session no longer exists (idempotent)', async () => {
    vi.mocked(deleteSession).mockResolvedValue(undefined);
    const result = await call(endEvent('sess-xyz-456'));
    expect(result.statusCode).toBe(204);
  });

  it('400 when the sessionId path param is missing', async () => {
    const result = await call(endEvent(undefined));
    expect(result.statusCode).toBe(400);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('403 when the caller is not an ACTIVE WebAdmin', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));
    const result = await call(endEvent('sess-xyz-456'));
    expect(result.statusCode).toBe(403);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
