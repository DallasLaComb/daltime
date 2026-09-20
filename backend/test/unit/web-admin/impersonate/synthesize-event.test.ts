import { describe, it, expect, vi, afterEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { synthesizeImpersonatedEvent } from '../../../../src/functions/web-admin/impersonate/synthesize-event.js';
import * as authModule from '../../../../src/functions/shared/auth.js';

// Verifies the event clone the impersonation proxy hands to a real role
// handler: the impersonated userId must end up as the resolved caller sub,
// and the path/pathParameters must look exactly like a direct call to the
// real route, with no other request data altered.

// ─── Randomized test data pool ────────────────────────────────────────────────
// Draw from these pools per test run so value-specific bugs surface over time.
// Log values on failure by using named variables in each test.

const USER_ID_POOL = [
  'imp-user-1',
  'usr-alpha-42',
  '00000000-1111-2222-3333-444444444444',
  'usr-beta-99',
  'a'.repeat(40),
];

const ROLE_POOL = ['Manager', 'Employee', 'OrgAdmin'] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildJwtHeader(): string {
  return Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
}

/**
 * Encode a minimal JWT with the given payload — real signature not needed for
 * these tests because `decodeLocalJwtPayload` does not verify the signature.
 */
function buildBearerToken(payload: Record<string, unknown>): string {
  const header = buildJwtHeader();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer ${header}.${body}.fakesig`;
}

// ─── Event builders ───────────────────────────────────────────────────────────

/** Deployed-path event: requestContext.authorizer.jwt.claims is fully populated. */
function buildDeployedEvent(
  impersonatedUserId = 'imp-user-1',
  extraClaims: Record<string, unknown> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
    rawPath: `/web-admin/impersonate/${impersonatedUserId}/manager/shifts/abc123`,
    rawQueryString: 'month=2026-07',
    headers: { authorization: 'Bearer web-admin-token', origin: 'http://localhost:4200' },
    queryStringParameters: { month: '2026-07' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { sub: 'web-admin-sub-1', ...extraClaims }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: `/web-admin/impersonate/${impersonatedUserId}/manager/shifts/abc123`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-id',
      routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: { userId: impersonatedUserId, proxy: 'manager/shifts/abc123' },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/** SAM-local-path event: no authorizer in requestContext; Authorization header carries the JWT. */
function buildSamLocalEvent(
  callerPayload: Record<string, unknown>,
  impersonatedUserId = 'imp-user-1',
  overrideHeader?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const authorizationHeader = overrideHeader ?? buildBearerToken(callerPayload);
  return {
    version: '2.0',
    routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
    rawPath: `/web-admin/impersonate/${impersonatedUserId}/manager/shifts/abc123`,
    rawQueryString: '',
    headers: { authorization: authorizationHeader, origin: 'http://localhost:4200' },
    queryStringParameters: undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      // authorizer intentionally absent (SAM local shape)
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: `/web-admin/impersonate/${impersonatedUserId}/manager/shifts/abc123`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-id',
      routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: { userId: impersonatedUserId, proxy: 'manager/shifts/abc123' },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}


// The acting WebAdmin threaded into every synthesized event as the RFC 8693
// `act` claim. A single fixture keeps the call sites focused on identity
// substitution while still exercising the real actor plumbing.
const TEST_ACTOR = { sub: 'web-admin-sub-1', web_admin_id: 'WADMIN#uuid-test' } as const;

/** Call the real synthesizer with the standard test actor. */
function synth(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  impersonatedUserId: string,
  realPath: string,
  pathParams: Record<string, string>,
  role: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return synthesizeImpersonatedEvent(event, impersonatedUserId, realPath, pathParams, role, TEST_ACTOR);
}

// Keep the original buildEvent() alias so pre-existing test helpers work unchanged.
function buildEvent(): APIGatewayProxyEventV2WithJWTAuthorizer {
  return buildDeployedEvent('imp-user-1');
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Deployed path ────────────────────────────────────────────────────────────

describe('synthesizeImpersonatedEvent — deployed path (requestContext.authorizer.jwt.claims present)', () => {
  it('substitutes the impersonated userId for the caller sub in the JWT claims', () => {
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).toBe('imp-user-1');
  });

  it('replaces pathParameters with only the real route params (drops userId/proxy)', () => {
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.pathParameters).toEqual({ shiftId: 'abc123' });
  });

  it('rewrites rawPath to the real-route-shaped path', () => {
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.rawPath).toBe('/web-admin/impersonate/imp-user-1/manager/shifts/abc123');
  });

  it('preserves the HTTP method, body, and query string unrelated to identity', () => {
    const original = buildEvent();
    const synthetic = synth(original, 'imp-user-1', 'manager/shifts/abc123', {
      shiftId: 'abc123',
    }, 'Manager');

    expect(synthetic.requestContext.http.method).toBe('GET');
    expect(synthetic.queryStringParameters).toEqual({ month: '2026-07' });
    expect(synthetic.body).toBe(original.body);
  });

  it('strips X-Impersonate-User so the real handler\'s withImpersonation wrapper does not resolve it a second time', () => {
    const original = buildEvent();
    original.headers = { ...original.headers, 'x-impersonate-user': 'imp-user-1', 'X-Impersonate-User': 'imp-user-1' };

    const synthetic = synth(original, 'imp-user-1', 'manager/shifts', {}, 'Manager');

    const names = Object.keys(synthetic.headers ?? {}).map((n) => n.toLowerCase());
    expect(names).not.toContain('x-impersonate-user');
    // Unrelated headers survive.
    expect(synthetic.headers?.['origin'] ?? synthetic.headers?.['authorization']).toBeDefined();
    // And the original event is untouched.
    expect(original.headers?.['x-impersonate-user']).toBe('imp-user-1');
  });

  it('does not mutate the original event object', () => {
    const original = buildEvent();
    synth(original, 'imp-user-1', 'manager/shifts/abc123', {
      shiftId: 'abc123',
    }, 'Manager');

    expect(original.requestContext.authorizer.jwt.claims['sub']).toBe('web-admin-sub-1');
    expect(original.pathParameters).toEqual({
      userId: 'imp-user-1',
      proxy: 'manager/shifts/abc123',
    });
  });

  it("synthesized event's sub is the impersonated user's sub, not the web-admin's sub", () => {
    // The downstream real-role handler resolves its caller via getCallerSub, which reads
    // requestContext.authorizer.jwt.claims.sub. This test explicitly confirms that claim
    // is the impersonated user's identity (not the web-admin's sub) in the synthesized event.
    const original = buildEvent(); // has sub: 'web-admin-sub-1'
    const synthetic = synth(
      original,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    // Impersonated sub is present.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).toBe('imp-user-1');
    // Web-admin's own sub is NOT the sub the downstream handler will see.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).not.toBe('web-admin-sub-1');
  });

  it('preserves the acting WebAdmin as RFC 8693 `act_*` claims alongside the impersonated subject', () => {
    // The actor must never be lost: the subject becomes the impersonated user,
    // but the `act_*` claims still identify who really initiated the request.
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['act_sub']).toBe(TEST_ACTOR.sub);
    expect(synthetic.requestContext.authorizer.jwt.claims['act_web_admin_id']).toBe(
      TEST_ACTOR.web_admin_id,
    );
    // The effective subject is still the impersonated user, not the actor.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).toBe('imp-user-1');
  });

  it("sets cognito:groups to the impersonated user's role, not the WebAdmin's group", () => {
    // Without overwriting cognito:groups, a downstream handler calling
    // getCallerGroups would see 'WebAdmin' (the caller who originally hit the
    // impersonate Lambda) rather than the impersonated user's actual role.
    // This would let manager-only or employee-only checks misbehave.
    const original = buildEvent(); // original has no cognito:groups claim set
    const synthetic = synth(
      original,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['cognito:groups']).toBe('Manager');
    expect(synthetic.requestContext.authorizer.jwt.claims['cognito:groups']).not.toBe('WebAdmin');
  });

  it("sets cognito:groups to 'Employee' when impersonating via an employee route", () => {
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'employee/shifts',
      {},
      'Employee',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['cognito:groups']).toBe('Employee');
  });

  it("sets cognito:groups to 'OrgAdmin' when impersonating via an org-admin route", () => {
    const synthetic = synth(
      buildEvent(),
      'imp-user-1',
      'org-admin/profile',
      {},
      'OrgAdmin',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['cognito:groups']).toBe('OrgAdmin');
  });

  it('does NOT call decodeLocalJwtPayload when requestContext.authorizer is present — fallback must not activate in deployed context', () => {
    // This is the critical regression guard: the no-auth fallback path must be
    // structurally dead in deployed-like contexts. Spy on decodeLocalJwtPayload
    // and confirm it is never called when the authorizer is populated.
    const decodeSpy = vi.spyOn(authModule, 'decodeLocalJwtPayload');

    synth(
      buildEvent(), // authorizer.jwt.claims is present
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it('reads claims from requestContext.authorizer.jwt.claims (not the Authorization header) when authorizer is present', () => {
    // Give the header a different sub than the authorizer claims.
    // The synthesized event must use the authorizer claims sub, confirming
    // the header is NOT consulted when the authorizer path is taken.
    const headerPayload = { sub: 'header-sub-should-be-ignored', 'cognito:groups': 'WebAdmin' };
    const event = buildSamLocalEvent(headerPayload, 'imp-user-1');
    // Now add an authorizer to simulate the deployed shape — overwrite
    // the SAM-local event to have requestContext.authorizer present with a different sub.
    const deployedEvent: APIGatewayProxyEventV2WithJWTAuthorizer = {
      ...event,
      requestContext: {
        ...event.requestContext,
        authorizer: {
          jwt: { claims: { sub: 'authorizer-sub', 'cognito:groups': 'WebAdmin' }, scopes: null },
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const synthetic = synth(
      deployedEvent,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    // Impersonated sub replaces the authorizer sub, not the header sub.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).toBe('imp-user-1');
    // The header sub should never appear in the synthesized claims.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).not.toBe('header-sub-should-be-ignored');
  });

  it('preserves extra authorizer claims from the deployed context in the synthesized event', () => {
    // Confirm that additional JWT claims beyond sub/cognito:groups (e.g. email,
    // token_use) are not silently dropped from the synthesized event.
    const extraClaims = {
      email: 'admin@example.com',
      token_use: 'access',
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
    };
    const event = buildDeployedEvent('imp-user-1', extraClaims);
    const synthetic = synth(
      event,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    expect(synthetic.requestContext.authorizer.jwt.claims['email']).toBe('admin@example.com');
    expect(synthetic.requestContext.authorizer.jwt.claims['token_use']).toBe('access');
  });

  it('works across a pool of randomized (userId, role) combinations without crashing', () => {
    // Randomised sweep — catches bugs that only appear for specific input values.
    for (const userId of USER_ID_POOL) {
      const role = pick(ROLE_POOL);
      const event = buildDeployedEvent(userId);
      const synthetic = synth(event, userId, `${role.toLowerCase()}/profile`, {}, role);

      // Log values explicitly so a failure is reproducible.
      const syntheticSub = synthetic.requestContext.authorizer.jwt.claims['sub'];
      const syntheticRole = synthetic.requestContext.authorizer.jwt.claims['cognito:groups'];
      expect(syntheticSub, `userId=${userId} role=${role}`).toBe(userId);
      expect(syntheticRole, `userId=${userId} role=${role}`).toBe(role);
    }
  });
});

// ─── SAM-local path ───────────────────────────────────────────────────────────

describe('synthesizeImpersonatedEvent — SAM-local path (requestContext.authorizer absent)', () => {
  it('resolves sub and cognito:groups from the Authorization header when authorizer is absent', () => {
    const callerPayload = { sub: 'web-admin-local-sub', 'cognito:groups': 'WebAdmin' };
    const event = buildSamLocalEvent(callerPayload, 'imp-user-1');

    const synthetic = synth(
      event,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    // sub must be the impersonated userId, not the caller's sub from the header.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).toBe('imp-user-1');
    // cognito:groups must be the impersonated user's role.
    expect(synthetic.requestContext.authorizer.jwt.claims['cognito:groups']).toBe('Manager');
    // The caller's original sub must not appear in the synthesized claims.
    expect(synthetic.requestContext.authorizer.jwt.claims['sub']).not.toBe('web-admin-local-sub');
  });

  it('preserves base claims from the decoded header (other than sub and cognito:groups) in the synthesized event', () => {
    const callerPayload = {
      sub: 'web-admin-local-sub',
      'cognito:groups': 'WebAdmin',
      email: 'local-dev@example.com',
      token_use: 'access',
    };
    const event = buildSamLocalEvent(callerPayload, 'imp-user-1');

    const synthetic = synth(
      event,
      'imp-user-1',
      'manager/shifts/abc123',
      { shiftId: 'abc123' },
      'Manager',
    );

    // Extra header claims should flow through to the synthesized event.
    expect(synthetic.requestContext.authorizer.jwt.claims['email']).toBe('local-dev@example.com');
    expect(synthetic.requestContext.authorizer.jwt.claims['token_use']).toBe('access');
  });

  it('throws a descriptive Error when Authorization header is missing entirely', () => {
    const event: APIGatewayProxyEventV2WithJWTAuthorizer = {
      version: '2.0',
      routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
      rawPath: '/web-admin/impersonate/imp-user-1/manager/shifts/abc123',
      rawQueryString: '',
      headers: {}, // no Authorization header
      queryStringParameters: undefined,
      requestContext: {
        // no authorizer — SAM local shape
        accountId: '123456789012',
        apiId: 'test-api',
        domainName: 'test.execute-api.us-east-1.amazonaws.com',
        domainPrefix: 'test',
        http: {
          method: 'GET',
          path: '/web-admin/impersonate/imp-user-1/manager/shifts/abc123',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test',
        },
        requestId: 'test-id',
        routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
        stage: '$default',
        time: '01/Jan/2026:00:00:00 +0000',
        timeEpoch: 1735689600000,
      },
      isBase64Encoded: false,
      body: null,
      pathParameters: { userId: 'imp-user-1', proxy: 'manager/shifts/abc123' },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    expect(() =>
      synth(event, 'imp-user-1', 'manager/shifts/abc123', {}, 'Manager'),
    ).toThrow('synthesizeImpersonatedEvent: could not resolve caller JWT claims');
  });

  it('throws a descriptive Error (not a silent crash) when Authorization header is not Bearer-prefixed', () => {
    const event = buildSamLocalEvent({}, 'imp-user-1', 'Basic dXNlcjpwYXNz');

    expect(() =>
      synth(event, 'imp-user-1', 'manager/shifts/abc123', {}, 'Manager'),
    ).toThrow('synthesizeImpersonatedEvent: could not resolve caller JWT claims');
  });

  it('throws a descriptive Error when Authorization header is present but has a truncated/malformed payload segment', () => {
    // A JWT with only one segment (no dots) — not a valid three-part token.
    const event = buildSamLocalEvent({}, 'imp-user-1', 'Bearer notavalidjwt');

    expect(() =>
      synth(event, 'imp-user-1', 'manager/shifts/abc123', {}, 'Manager'),
    ).toThrow('synthesizeImpersonatedEvent: could not resolve caller JWT claims');
  });

  it('throws a descriptive Error when the JWT payload segment is not valid JSON after base64 decode', () => {
    // Build a token whose payload segment encodes garbage, not JSON.
    const header = buildJwtHeader();
    const badPayload = Buffer.from('not-json-at-all!!!').toString('base64url');
    const event = buildSamLocalEvent({}, 'imp-user-1', `Bearer ${header}.${badPayload}.fakesig`);

    expect(() =>
      synth(event, 'imp-user-1', 'manager/shifts/abc123', {}, 'Manager'),
    ).toThrow('synthesizeImpersonatedEvent: could not resolve caller JWT claims');
  });

  it('does not crash with a TypeError when requestContext itself is undefined', () => {
    // Extreme SAM local edge case: the entire requestContext could be absent
    // (e.g. a hand-crafted test event). Must surface a descriptive Error, not
    // an unhandled "Cannot read properties of undefined" TypeError.
    const event = {
      version: '2.0',
      routeKey: 'GET /web-admin/impersonate/{userId}/{proxy+}',
      rawPath: '/web-admin/impersonate/imp-user-1/manager/shifts/abc123',
      rawQueryString: '',
      headers: {}, // no Authorization header either
      queryStringParameters: undefined,
      requestContext: undefined, // completely absent
      isBase64Encoded: false,
      body: null,
      pathParameters: { userId: 'imp-user-1', proxy: 'manager/shifts/abc123' },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    // Must throw our own descriptive Error, not a native TypeError.
    expect(() =>
      synth(event, 'imp-user-1', 'manager/shifts/abc123', {}, 'Manager'),
    ).toThrow('synthesizeImpersonatedEvent: could not resolve caller JWT claims');
  });

  it('works for varied (userId, role) combinations in SAM-local mode without crashing', () => {
    for (const userId of USER_ID_POOL) {
      const role = pick(ROLE_POOL);
      const callerPayload = { sub: 'local-web-admin-sub', 'cognito:groups': 'WebAdmin' };
      const event = buildSamLocalEvent(callerPayload, userId);

      const synthetic = synth(
        event,
        userId,
        `${role.toLowerCase()}/profile`,
        {},
        role,
      );

      const syntheticSub = synthetic.requestContext.authorizer.jwt.claims['sub'];
      const syntheticRole = synthetic.requestContext.authorizer.jwt.claims['cognito:groups'];
      expect(syntheticSub, `userId=${userId} role=${role}`).toBe(userId);
      expect(syntheticRole, `userId=${userId} role=${role}`).toBe(role);
    }
  });
});
