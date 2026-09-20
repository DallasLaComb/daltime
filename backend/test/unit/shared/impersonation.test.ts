/**
 * `withImpersonation` is the single chokepoint for a WebAdmin acting as another user, so these
 * tests are deliberately adversarial. They run against the REAL `requireWebAdminWithLookup`
 * (only the two DynamoDB lookups are mocked) so the ordering of the checks is what is verified:
 * identity first, then read-only, then header shape, then route role, then target membership.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../src/functions/web-admin/shared/db.js', () => ({ getWebAdminLookup: vi.fn() }));
vi.mock('../../../src/functions/web-admin/impersonate/db.js', () => ({
  isRoleMember: vi.fn(),
  getSession: vi.fn(),
  putAuditRecord: vi.fn(),
}));

import {
  withImpersonation,
  roleForPath,
  readImpersonationHeader,
} from '../../../src/functions/shared/impersonation.js';
import { getCallerSub, getCallerGroups } from '../../../src/functions/shared/auth.js';
import { getWebAdminLookup } from '../../../src/functions/web-admin/shared/db.js';
import { isRoleMember, getSession, putAuditRecord } from '../../../src/functions/web-admin/impersonate/db.js';

const ADMIN_SUB = 'admin-sub-1';
const TARGET = 'target-user-42';

const ACTIVE_SESSION = {
  session_id: 'sess-abc-123',
  actor_sub: ADMIN_SUB,
  actor_web_admin_id: 'WADMIN#abc',
  target_user_id: TARGET,
  role: 'Manager' as const,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ttl: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
};

const ACTIVE_ADMIN = {
  sub: ADMIN_SUB,
  web_admin_id: 'WADMIN#abc',
  email: 'admin@example.dev',
  status: 'ACTIVE' as const,
};

function buildEvent(
  o: {
    method?: string;
    path?: string;
    groups?: string;
    sub?: string;
    headers?: Record<string, string>;
    authorizer?: boolean;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = o.method ?? 'GET';
  const path = o.path ?? '/manager/shifts';
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { origin: 'http://localhost:4200', 'x-impersonate-user': TARGET, ...o.headers },
    requestContext: {
      ...(o.authorizer === false
        ? {}
        : {
            authorizer: {
              jwt: {
                claims: { sub: o.sub ?? ADMIN_SUB, 'cognito:groups': o.groups ?? '[WebAdmin]', extra: 'kept' },
                scopes: null,
              },
            },
          }),
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
    pathParameters: {},
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const okResult = { statusCode: 200, body: '"inner"' };
const inner = vi.fn(async (_e: APIGatewayProxyEventV2WithJWTAuthorizer) => okResult);
const handler = withImpersonation(inner);

const run = async (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  (await handler(e)) as APIGatewayProxyStructuredResultV2;
const errorOf = (r: APIGatewayProxyStructuredResultV2) => JSON.parse(r.body as string).error as string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWebAdminLookup).mockResolvedValue(ACTIVE_ADMIN);
  vi.mocked(isRoleMember).mockResolvedValue(true);
  vi.mocked(getSession).mockResolvedValue(ACTIVE_SESSION);
  vi.mocked(putAuditRecord).mockResolvedValue(undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('pass-through (no impersonation requested)', () => {
  it('calls the inner handler with the untouched event and does no lookups', async () => {
    const event = buildEvent({ groups: '[Manager]', sub: 'mgr-1', headers: { 'x-impersonate-user': '' } });
    delete event.headers['x-impersonate-user'];

    const result = await handler(event);

    expect(result).toBe(okResult);
    expect(inner).toHaveBeenCalledWith(event);
    expect(getWebAdminLookup).not.toHaveBeenCalled();
    expect(isRoleMember).not.toHaveBeenCalled();
  });

  it('ignores the header on CORS preflight (OPTIONS carries none, and must never be gated)', async () => {
    const event = buildEvent({ method: 'OPTIONS', groups: '[Manager]' });
    expect(await handler(event)).toBe(okResult);
    expect(getWebAdminLookup).not.toHaveBeenCalled();
  });
});

describe('identity is checked first — a non-WebAdmin never gets past the header', () => {
  it.each([
    ['a Manager', '[Manager]'],
    ['an Employee', '[Employee]'],
    ['an OrgAdmin', '[OrgAdmin]'],
    ['a caller with no groups', ''],
  ])('403 for %s, inner never called, nothing looked up', async (_label, groups) => {
    const result = await run(buildEvent({ groups }));

    expect(result.statusCode).toBe(403);
    expect(errorOf(result)).toMatch(/WebAdmin/);
    expect(inner).not.toHaveBeenCalled();
    expect(getWebAdminLookup).not.toHaveBeenCalled();
    expect(isRoleMember).not.toHaveBeenCalled();
  });

  it('403 when the WebAdmin group is present but no provisioned DynamoDB record exists', async () => {
    vi.mocked(getWebAdminLookup).mockResolvedValue(null);
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(403);
    expect(inner).not.toHaveBeenCalled();
    expect(isRoleMember).not.toHaveBeenCalled();
  });

  it('403 when the WebAdmin record is DISABLED (takes effect without revoking the Cognito token)', async () => {
    vi.mocked(getWebAdminLookup).mockResolvedValue({ ...ACTIVE_ADMIN, status: 'DISABLED' });
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('answers a non-WebAdmin identically regardless of route or target validity (no probing)', async () => {
    const a = await run(buildEvent({ groups: '[Manager]', path: '/manager/shifts' }));
    const b = await run(buildEvent({ groups: '[Manager]', path: '/web-admin/profile', headers: { 'x-impersonate-user': 'a#b' } }));
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(errorOf(a)).toBe(errorOf(b));
  });
});

describe('read-only', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '403 for %s — rejected before the target is even looked up',
    async (method) => {
      const result = await run(buildEvent({ method }));

      expect(result.statusCode).toBe(403);
      expect(errorOf(result)).toBe('Impersonation sessions are read-only');
      expect(isRoleMember).not.toHaveBeenCalled();
      expect(inner).not.toHaveBeenCalled();
    },
  );
});

describe('the header value is validated before it reaches a DynamoDB key', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['contains #', 'abc#def'],
    ['sent twice (comma-joined)', 'a,b'],
    ['contains a space', 'abc def'],
    ['contains a slash', 'abc/def'],
    ['too long', 'x'.repeat(129)],
  ])('400 when %s', async (_label, value) => {
    const result = await run(buildEvent({ headers: { 'x-impersonate-user': value } }));

    expect(result.statusCode).toBe(400);
    expect(isRoleMember).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace on an otherwise valid id', async () => {
    await run(buildEvent({ headers: { 'x-impersonate-user': `  ${TARGET}  ` } }));
    expect(isRoleMember).toHaveBeenCalledWith(TARGET, 'Manager');
  });
});

describe('route role', () => {
  it.each([
    ['/manager/shifts', 'Manager'],
    ['/employee/profile', 'Employee'],
    ['/org-admin/locations', 'OrgAdmin'],
    ['/manager/employees/emp-1/availability', 'Manager'],
    ['/manager/notifications', 'Manager'],
    ['/employee/notifications', 'Employee'],
    ['/org-admin/notifications', 'OrgAdmin'],
  ] as const)('%s is served as %s', async (path, role) => {
    vi.mocked(getSession).mockResolvedValue({ ...ACTIVE_SESSION, role });
    await run(buildEvent({ path }));
    expect(isRoleMember).toHaveBeenCalledWith(TARGET, role);
    const seen = inner.mock.calls[0]![0];
    expect(getCallerGroups(seen)).toEqual([role]);
  });

  it.each(['/web-admin/notifications', '/web-admin/profile', '/health', '/organizations', '/'])(
    '400 for the non-impersonatable route %s',
    async (path) => {
      const result = await run(buildEvent({ path }));
      expect(result.statusCode).toBe(400);
      expect(errorOf(result)).toMatch(/not supported/);
      expect(isRoleMember).not.toHaveBeenCalled();
      expect(inner).not.toHaveBeenCalled();
    },
  );
});

describe('target verification', () => {
  it('404 when the target is not a member of the ROUTE\'s role (an Employee id on a /manager route)', async () => {
    vi.mocked(isRoleMember).mockResolvedValue(false);

    const result = await run(buildEvent({ path: '/manager/shifts' }));

    expect(result.statusCode).toBe(404);
    expect(isRoleMember).toHaveBeenCalledWith(TARGET, 'Manager');
    expect(inner).not.toHaveBeenCalled();
  });

  it('500 (not a partial impersonation) when the membership lookup itself fails', async () => {
    vi.mocked(isRoleMember).mockRejectedValue(new Error('DynamoDB down'));
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(500);
    expect(inner).not.toHaveBeenCalled();
  });
});

describe('the effective event the real handler sees', () => {
  it('is indistinguishable from the target\'s own request, with the actor preserved as act_* claims', async () => {
    const original = buildEvent({ path: '/manager/shifts' });
    const result = await handler(original);

    expect(result).toBe(okResult);
    expect(inner).toHaveBeenCalledTimes(1);
    const seen = inner.mock.calls[0]![0];

    // Identity is the target's, via the same helpers every role handler already uses.
    expect(getCallerSub(seen)).toBe(TARGET);
    expect(getCallerGroups(seen)).toEqual(['Manager']);
    // The actor is never lost.
    const claims = seen.requestContext.authorizer.jwt.claims as Record<string, unknown>;
    expect(claims['act_sub']).toBe(ADMIN_SUB);
    expect(claims['act_web_admin_id']).toBe('WADMIN#abc');
    // Unrelated verified claims survive; the request itself is untouched.
    expect(claims['extra']).toBe('kept');
    expect(seen.rawPath).toBe('/manager/shifts');
    expect(seen.requestContext.http.method).toBe('GET');
    // The header is consumed, so nothing downstream can re-resolve it.
    expect(Object.keys(seen.headers).map((h) => h.toLowerCase())).not.toContain('x-impersonate-user');
    expect(seen.headers['origin']).toBe('http://localhost:4200');
  });

  it('does not mutate the incoming event', async () => {
    const original = buildEvent();
    const snapshot = JSON.stringify(original);
    await handler(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('matches the header name case-insensitively', async () => {
    const event = buildEvent({ headers: { 'X-Impersonate-User': TARGET } });
    delete event.headers['x-impersonate-user'];
    await run(event);
    expect(getCallerSub(inner.mock.calls[0]![0])).toBe(TARGET);
  });

  it('cannot be tricked by a client-supplied act_* claim: the actor is always the verified caller', async () => {
    const event = buildEvent();
    const claims = event.requestContext.authorizer.jwt.claims as Record<string, unknown>;
    claims['act_sub'] = 'someone-else';
    claims['act_web_admin_id'] = 'WADMIN#forged';

    await run(event);

    const seen = inner.mock.calls[0]![0].requestContext.authorizer.jwt.claims as Record<string, unknown>;
    expect(seen['act_sub']).toBe(ADMIN_SUB);
    expect(seen['act_web_admin_id']).toBe('WADMIN#abc');
  });

  it('works in SAM local, where there is no authorizer and claims come from the Authorization header', async () => {
    const payload = Buffer.from(JSON.stringify({ sub: ADMIN_SUB, 'cognito:groups': ['WebAdmin'] })).toString('base64url');
    const event = buildEvent({ authorizer: false, headers: { authorization: `Bearer h.${payload}.s` } });

    await run(event);

    const seen = inner.mock.calls[0]![0];
    expect(getCallerSub(seen)).toBe(TARGET);
    expect(getCallerGroups(seen)).toEqual(['Manager']);
    expect((seen.requestContext.authorizer.jwt.claims as Record<string, unknown>)['act_sub']).toBe(ADMIN_SUB);
  });
});

describe('session validation', () => {
  it('403 when no session exists for this actor', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(403);
    expect(errorOf(result)).toMatch(/No active impersonation session/);
    expect(isRoleMember).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it('403 when the session has expired', async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...ACTIVE_SESSION,
      expires_at: new Date(Date.now() - 1).toISOString(),
    });
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(403);
    expect(errorOf(result)).toMatch(/No active impersonation session/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('403 when the session targets a different user than the header', async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...ACTIVE_SESSION,
      target_user_id: 'some-other-user',
    });
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(403);
    expect(errorOf(result)).toMatch(/No active impersonation session/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('403 when the session role does not match the route role', async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...ACTIVE_SESSION,
      role: 'Employee' as const, // session is for Employee but route is /manager/
    });
    const result = await run(buildEvent({ path: '/manager/shifts' }));
    expect(result.statusCode).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('200 when a valid matching session exists', async () => {
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(200);
    expect(getSession).toHaveBeenCalledWith(ADMIN_SUB);
  });
});

describe('audit and error handling', () => {
  it('logs a structured audit line naming actor, target, and session_id — never the token', async () => {
    await run(buildEvent({ headers: { authorization: 'Bearer SECRET.TOKEN.VALUE' } }));

    const line = vi.mocked(console.info).mock.calls.map((c) => String(c[0])).find((l) => l.includes('impersonation'))!;
    expect(line).toBeDefined();
    expect(JSON.parse(line)).toMatchObject({
      audit: 'impersonation',
      session_id: ACTIVE_SESSION.session_id,
      actor_web_admin_id: 'WADMIN#abc',
      actor_sub: ADMIN_SUB,
      target_user_id: TARGET,
      role: 'Manager',
      method: 'GET',
      path: '/manager/shifts',
    });
    expect(line).not.toContain('SECRET');
  });

  it('writes a DynamoDB audit record for each impersonated call', async () => {
    await run(buildEvent());
    expect(putAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: ACTIVE_SESSION.session_id }),
      'GET',
      '/manager/shifts',
    );
  });

  it('does not block the response when the audit record write fails', async () => {
    vi.mocked(putAuditRecord).mockRejectedValue(new Error('DynamoDB down'));
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(200);
    expect(inner).toHaveBeenCalled();
  });

  it('writes no audit line when the request is rejected', async () => {
    await run(buildEvent({ method: 'POST' }));
    await run(buildEvent({ groups: '[Manager]' }));
    expect(vi.mocked(console.info)).not.toHaveBeenCalled();
  });

  it('turns an unexpected error from the real handler into a generic 500 without leaking it', async () => {
    inner.mockRejectedValueOnce(new Error('secret internal detail'));
    const result = await run(buildEvent());
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('secret internal detail');
  });

  it('includes CORS headers on rejections so the browser can read the error', async () => {
    const result = await run(buildEvent({ groups: '[Manager]' }));
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });
});

describe('helpers', () => {
  it('roleForPath maps only the three impersonatable prefixes', () => {
    expect(roleForPath('/manager/x')).toBe('Manager');
    expect(roleForPath('manager/x')).toBe('Manager');
    expect(roleForPath('/org-admin/x')).toBe('OrgAdmin');
    expect(roleForPath('/employee')).toBe('Employee');
    expect(roleForPath('/web-admin/x')).toBeUndefined();
    expect(roleForPath('/managers')).toBeUndefined();
    expect(roleForPath('')).toBeUndefined();
  });

  it('readImpersonationHeader is case-insensitive and tolerates missing headers', () => {
    expect(readImpersonationHeader({ headers: { 'X-Impersonate-User': 'u' } } as never)).toBe('u');
    expect(readImpersonationHeader({ headers: {} } as never)).toBeUndefined();
    expect(readImpersonationHeader({} as never)).toBeUndefined();
  });
});
