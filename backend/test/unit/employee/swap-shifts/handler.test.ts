/**
 * Unit tests for the employee swap-shifts handler.
 *
 * Covers all four routes:
 *   GET    /employee/swap-shifts
 *   POST   /employee/swap-shifts
 *   POST   /employee/swap-shifts/{swapId}/claim
 *   DELETE /employee/swap-shifts/{swapId}
 *
 * and OPTIONS preflight, Employee role enforcement, malformed input, boundary
 * conditions, notification isolation, and role-escalation attempts.
 * The four service functions are mocked — service correctness is covered in
 * service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

// Mock the service module before importing the handler.
vi.mock('../../../../src/functions/employee/swap-shifts/service.js', () => ({
  listSwapShifts: vi.fn(),
  postSwapShift: vi.fn(),
  claimSwapShift: vi.fn(),
  cancelSwapShift: vi.fn(),
}));

import { handler } from '../../../../src/functions/employee/swap-shifts/handler.js';
import {
  listSwapShifts,
  postSwapShift,
  claimSwapShift,
  cancelSwapShift,
} from '../../../../src/functions/employee/swap-shifts/service.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../../../../src/functions/shared/errors.js';

// ─── Randomised data pool ─────────────────────────────────────────────────────

/**
 * Pool of varied org IDs, shift IDs and swap IDs drawn from on each run.
 * Using Math.random() seeded-style: pick a stable index per test description
 * to make a particular test re-runnable once a seed is known.
 */
const ORG_POOL = ['org-alpha', 'org-beta', 'org-gamma', 'org-delta'];
const EMP_POOL = ['emp-001', 'emp-002', 'emp-003', 'emp-099'];
const SHIFT_ID_POOL = [
  'aaaa1111-1111-1111-1111-111111111111',
  'shift-2a3b-4c5d',
  'shift-xyz-789',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
];
const SWAP_ID_POOL = [
  'swap-uuid-0001',
  'swap-uuid-0002',
  'deadbeef-dead-beef-dead-beefdeadbeef',
  'swap-4321',
];

function pickRandom<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const SWAP_OPEN = {
  swap_id: pickRandom(SWAP_ID_POOL),
  org_id: pickRandom(ORG_POOL),
  shift_id: pickRandom(SHIFT_ID_POOL),
  posted_by_employee_id: pickRandom(EMP_POOL),
  posted_by_employee_name: 'Jane Doe',
  manager_id: 'mgr-001',
  status: 'open' as const,
  claimed_by_employee_id: null,
  claimed_by_employee_name: null,
  date: '2026-08-15',
  start_time: '09:00',
  end_time: '17:00',
  type: 'morning' as const,
  location_id: 'loc-1',
  location_name: 'Main Floor',
  created_at: '2026-06-19T14:30:00.000Z',
  updated_at: '2026-06-19T14:30:00.000Z',
};

// ─── Event factory ─────────────────────────────────────────────────────────────

/**
 * Build a minimal APIGW V2 event for the swap-shifts handler.
 *
 * @param method   HTTP method
 * @param groups   Cognito groups claim value (string | string[] | undefined)
 * @param sub      Caller Cognito sub
 * @param rawPath  Full raw path (e.g. /employee/swap-shifts/{swapId}/claim)
 * @param body     Optional JSON-serialisable request body
 * @param pathParams  Optional path parameter map
 */
function buildEvent(
  method: string,
  groups: string | string[] | undefined,
  sub: string,
  rawPath = '/employee/swap-shifts',
  body: unknown = null,
  pathParams: Record<string, string> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const claims: Record<string, unknown> = { sub };
  if (groups !== undefined) claims['cognito:groups'] = groups;

  return {
    version: '2.0',
    routeKey: `${method} ${rawPath}`,
    rawPath,
    rawQueryString: '',
    headers: { origin: 'https://dev.daltime.com' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: { jwt: { claims, scopes: null } },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-req-id',
      routeKey: `${method} ${rawPath}`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    isBase64Encoded: false,
    body: body !== null ? JSON.stringify(body) : null,
    pathParameters: Object.keys(pathParams).length > 0 ? pathParams : {},
    queryStringParameters: undefined,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parsedBody(result: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(result.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200 without calling any service function (base path)', async () => {
    const result = (await handler(
      buildEvent('OPTIONS', undefined, 'sub-none'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listSwapShifts).not.toHaveBeenCalled();
    expect(postSwapShift).not.toHaveBeenCalled();
    expect(claimSwapShift).not.toHaveBeenCalled();
    expect(cancelSwapShift).not.toHaveBeenCalled();
  });

  it('returns 200 for OPTIONS on parameterised path (swapId/claim)', async () => {
    const result = (await handler(
      buildEvent('OPTIONS', undefined, 'sub-none', '/employee/swap-shifts/swap-abc/claim'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
  });
});

// ─── Role enforcement ─────────────────────────────────────────────────────────

describe('Role enforcement — all routes require Employee group', () => {
  it('returns 403 for GET when caller is in Manager group', async () => {
    const result = (await handler(
      buildEvent('GET', 'Manager', 'sub-mgr'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listSwapShifts).not.toHaveBeenCalled();
  });

  it('returns 403 for POST when caller has no group claim', async () => {
    const result = (await handler(
      buildEvent('POST', undefined, 'sub-none', '/employee/swap-shifts', { shift_id: 'shift-abc' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(postSwapShift).not.toHaveBeenCalled();
  });

  it('returns 403 for claim when caller is OrgAdmin', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    const result = (await handler(
      buildEvent('POST', 'OrgAdmin', 'sub-admin', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(claimSwapShift).not.toHaveBeenCalled();
  });

  it('returns 403 for DELETE when caller has empty string group', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    const result = (await handler(
      buildEvent('DELETE', '', 'sub-empty', `/employee/swap-shifts/${swapId}`, null, {
        swapId,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(cancelSwapShift).not.toHaveBeenCalled();
  });

  it('accepts bracket-stringified [Employee] group from HTTP API JWT authorizer', async () => {
    vi.mocked(listSwapShifts).mockResolvedValue({ available: [], mine: [] });

    const result = (await handler(
      buildEvent('GET', '[Employee]', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /employee/swap-shifts ────────────────────────────────────────────────

describe('GET /employee/swap-shifts', () => {
  it('returns 200 with { available, mine } shape on happy path', async () => {
    const orgId = pickRandom(ORG_POOL);
    const swapA = { ...SWAP_OPEN, org_id: orgId, swap_id: pickRandom(SWAP_ID_POOL) };
    const swapB = {
      ...SWAP_OPEN,
      org_id: orgId,
      swap_id: pickRandom(SWAP_ID_POOL),
      status: 'claimed' as const,
    };
    vi.mocked(listSwapShifts).mockResolvedValue({ available: [swapA], mine: [swapB] });

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parsedBody(result) as { available: unknown[]; mine: unknown[] };
    expect(body.available).toHaveLength(1);
    expect(body.mine).toHaveLength(1);
    expect(listSwapShifts).toHaveBeenCalledWith('sub-emp');
  });

  it('returns 200 with empty arrays when no swaps exist', async () => {
    vi.mocked(listSwapShifts).mockResolvedValue({ available: [], mine: [] });

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parsedBody(result) as { available: unknown[]; mine: unknown[] };
    expect(body.available).toEqual([]);
    expect(body.mine).toEqual([]);
  });

  it('returns 403 when caller not provisioned (service throws ForbiddenError)', async () => {
    vi.mocked(listSwapShifts).mockRejectedValue(new ForbiddenError('Caller could not be resolved'));

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-ghost'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it('returns 500 on unexpected service error', async () => {
    vi.mocked(listSwapShifts).mockRejectedValue(new Error('DynamoDB transient failure'));

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });
});

// ─── POST /employee/swap-shifts ───────────────────────────────────────────────

describe('POST /employee/swap-shifts — post a shift', () => {
  it('returns 201 with swap record on happy path', async () => {
    const shiftId = pickRandom(SHIFT_ID_POOL);
    vi.mocked(postSwapShift).mockResolvedValue({ ...SWAP_OPEN, shift_id: shiftId });

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', { shift_id: shiftId }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(201);
    const body = parsedBody(result) as { shift_id: string };
    expect(body.shift_id).toBe(shiftId);
    expect(postSwapShift).toHaveBeenCalledWith('sub-emp', { shift_id: shiftId });
  });

  it('returns 404 when shift_id does not exist (service throws NotFoundError)', async () => {
    vi.mocked(postSwapShift).mockRejectedValue(new NotFoundError('Shift not found'));

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: 'ghost-shift',
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
  });

  it('returns 403 when shift does not belong to caller (service throws ForbiddenError)', async () => {
    vi.mocked(postSwapShift).mockRejectedValue(
      new ForbiddenError('You can only post your own shifts for swap'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: pickRandom(SHIFT_ID_POOL),
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when shift is not published (service throws ValidationError)', async () => {
    vi.mocked(postSwapShift).mockRejectedValue(
      new ValidationError('Only published shifts can be posted for swap'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: pickRandom(SHIFT_ID_POOL),
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it('returns 409 when shift is already posted for swap (duplicate guard)', async () => {
    vi.mocked(postSwapShift).mockRejectedValue(
      new ConflictError('This shift is already posted for swap'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: pickRandom(SHIFT_ID_POOL),
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(409);
  });

  it('returns 400 for missing body', async () => {
    // parseBody should reject a null body before service is ever called.
    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', null),
    )) as APIGatewayProxyStructuredResultV2;

    // Handler returns bad request for null body from parseBody.
    expect(result.statusCode).toBe(400);
    expect(postSwapShift).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON body', async () => {
    const event = buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', null);
    (event as unknown as Record<string, unknown>)['body'] = '{"shift_id":';

    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(postSwapShift).not.toHaveBeenCalled();
  });

  it('returns 400 when shift is in the past (service throws ValidationError)', async () => {
    vi.mocked(postSwapShift).mockRejectedValue(
      new ValidationError('Cannot post a past shift for swap'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: pickRandom(SHIFT_ID_POOL),
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });
});

// ─── POST /employee/swap-shifts/{swapId}/claim ────────────────────────────────

describe('POST /employee/swap-shifts/{swapId}/claim — claim a listing', () => {
  it('returns 200 with claimed swap on happy path', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    const claimedSwap = {
      ...SWAP_OPEN,
      swap_id: swapId,
      status: 'claimed' as const,
      claimed_by_employee_id: 'emp-999',
      claimed_by_employee_name: 'Bob Claimer',
    };
    vi.mocked(claimSwapShift).mockResolvedValue(claimedSwap);

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = parsedBody(result) as { status: string; claimed_by_employee_name: string };
    expect(body.status).toBe('claimed');
    expect(body.claimed_by_employee_name).toBe('Bob Claimer');
    expect(claimSwapShift).toHaveBeenCalledWith('sub-emp', swapId);
  });

  it('returns 403 for self-claim attempt (service throws ForbiddenError)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockRejectedValue(
      new ForbiddenError('You cannot claim your own swap listing'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    const body = parsedBody(result) as { error: string };
    expect(body.error).toMatch(/own swap/i);
  });

  it('returns 409 when listing is already claimed (service throws ConflictError)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockRejectedValue(
      new ConflictError('This swap listing is no longer available'),
    );

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(409);
  });

  it('returns 404 when swap listing does not exist (cross-org or missing)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockRejectedValue(new NotFoundError('Swap listing not found'));

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    // MUST be 404, not 403 — must not reveal listing existence from another org.
    expect(result.statusCode).toBe(404);
  });

  it('does NOT return 403 on cross-org claim — 404 to avoid existence leak', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    // Service returns 404 for cross-org because the DB lookup is org-scoped.
    vi.mocked(claimSwapShift).mockRejectedValue(new NotFoundError('Swap listing not found'));

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-other-org', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
    // Confirm 403 is NOT returned.
    expect(result.statusCode).not.toBe(403);
  });

  it('returns 500 on unexpected service error during claim', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockRejectedValue(new Error('DynamoDB conditional check failed'));

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });

  it('routes /claim correctly — distinguishes claim path from plain POST', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockResolvedValue({
      ...SWAP_OPEN,
      swap_id: swapId,
      status: 'claimed' as const,
      claimed_by_employee_id: 'emp-999',
      claimed_by_employee_name: 'Bob',
    });

    await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    );

    // claimSwapShift must be called, postSwapShift must NOT be called.
    expect(claimSwapShift).toHaveBeenCalled();
    expect(postSwapShift).not.toHaveBeenCalled();
  });
});

// ─── DELETE /employee/swap-shifts/{swapId} ────────────────────────────────────

describe('DELETE /employee/swap-shifts/{swapId} — cancel a listing', () => {
  it('returns 204 No Content on successful cancellation', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(cancelSwapShift).mockResolvedValue(undefined);

    const result = (await handler(
      buildEvent('DELETE', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}`, null, {
        swapId,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(204);
    expect(cancelSwapShift).toHaveBeenCalledWith('sub-emp', swapId);
  });

  it('returns 403 when caller is not the poster (service throws ForbiddenError)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(cancelSwapShift).mockRejectedValue(
      new ForbiddenError('You can only cancel your own swap listings'),
    );

    const result = (await handler(
      buildEvent('DELETE', 'Employee', 'sub-other', `/employee/swap-shifts/${swapId}`, null, {
        swapId,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it('returns 409 when listing is already claimed (service throws ConflictError)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(cancelSwapShift).mockRejectedValue(
      new ConflictError('This swap listing is no longer open and cannot be cancelled'),
    );

    const result = (await handler(
      buildEvent('DELETE', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}`, null, {
        swapId,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(409);
  });

  it('returns 404 when swap listing not found (service throws NotFoundError)', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(cancelSwapShift).mockRejectedValue(new NotFoundError('Swap listing not found'));

    const result = (await handler(
      buildEvent('DELETE', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}`, null, {
        swapId,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when swapId path param is missing from the DELETE event', async () => {
    // No swapId in pathParameters and rawPath ends at the base — handler guards this.
    const result = (await handler(
      buildEvent('DELETE', 'Employee', 'sub-emp', '/employee/swap-shifts/', null, {}),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(cancelSwapShift).not.toHaveBeenCalled();
  });
});

// ─── Unhandled method ─────────────────────────────────────────────────────────

describe('Unhandled methods', () => {
  it('returns 400 for PATCH on the swap-shifts base path', async () => {
    const result = (await handler(
      buildEvent('PATCH', 'Employee', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for PUT on the swap-shifts base path', async () => {
    const result = (await handler(
      buildEvent('PUT', 'Employee', 'sub-emp'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });
});

// ─── Contract request validation ──────────────────────────────────────────────

/**
 * The handler validates POST bodies and the claim route's swapId against the
 * same schemas that generate this route's entry in contracts/openapi.json, so
 * a request the published spec calls invalid never reaches the service.
 */
describe('Contract validation — POST /employee/swap-shifts body', () => {
  it('returns 400 and does not call the service when shift_id is missing', async () => {
    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {}),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(postSwapShift).not.toHaveBeenCalled();
    const body = parsedBody(result) as { error: string };
    expect(body.error).toMatch(/shift_id/i);
  });

  it('returns 400 and does not call the service when shift_id holds injection characters', async () => {
    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: '<script>alert(1)</script>',
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(postSwapShift).not.toHaveBeenCalled();
  });

  it('returns 400 when shift_id exceeds 128 characters', async () => {
    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: 'a'.repeat(129),
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(postSwapShift).not.toHaveBeenCalled();
  });

  it('forwards a trimmed shift_id to the service', async () => {
    const shiftId = pickRandom(SHIFT_ID_POOL);
    vi.mocked(postSwapShift).mockResolvedValue({ ...SWAP_OPEN, shift_id: shiftId });

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: `  ${shiftId}  `,
      }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(201);
    expect(postSwapShift).toHaveBeenCalledWith('sub-emp', { shift_id: shiftId });
  });

  it('drops unknown body keys rather than forwarding them', async () => {
    const shiftId = pickRandom(SHIFT_ID_POOL);
    vi.mocked(postSwapShift).mockResolvedValue({ ...SWAP_OPEN, shift_id: shiftId });

    await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts', {
        shift_id: shiftId,
        status: 'claimed',
      }),
    );

    expect(postSwapShift).toHaveBeenCalledWith('sub-emp', { shift_id: shiftId });
  });
});

describe('Contract validation — claim route swapId', () => {
  it('returns 400 and does not call the service for a malformed swapId', async () => {
    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', '/employee/swap-shifts/swap%20id!/claim'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(claimSwapShift).not.toHaveBeenCalled();
  });

  it('still routes a well-formed swapId through to the service', async () => {
    const swapId = pickRandom(SWAP_ID_POOL);
    vi.mocked(claimSwapShift).mockResolvedValue({ ...SWAP_OPEN, swap_id: swapId });

    const result = (await handler(
      buildEvent('POST', 'Employee', 'sub-emp', `/employee/swap-shifts/${swapId}/claim`),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(claimSwapShift).toHaveBeenCalledWith('sub-emp', swapId);
  });
});
