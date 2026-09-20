import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../../src/functions/org-admin/locations/service.js', () => ({
  getLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  removeLocation: vi.fn(),
}));

import { handler } from '../../../../src/functions/org-admin/locations/handler.js';
import { UpdateOrgAdminLocationBody } from '@daltime/contracts';
import { contractErrorMessage } from '../../helpers/contract-error.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../src/functions/shared/errors.js';
import {
  getLocations,
  createLocation,
  updateLocation,
  removeLocation,
} from '../../../../src/functions/org-admin/locations/service.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /org-admin/locations`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/org-admin/locations',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: {
          claims: { 'cognito:groups': 'OrgAdmin', sub: 'orgadmin-sub-123' },
          scopes: null,
        },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/org-admin/locations',
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

const mockLocation = {
  location_id: 'loc-123',
  org_id: 'org-123',
  name: 'Main Office',
  address: '123 Main St',
  created_by: 'orgadmin-sub-123',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

beforeEach(() => vi.clearAllMocks());

// ─── OPTIONS ─────────────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /org-admin/locations' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /org-admin/locations ─────────────────────────────────────────────────

describe('GET /org-admin/locations — list', () => {
  it('returns 200 with array of locations', async () => {
    vi.mocked(getLocations).mockResolvedValue([mockLocation]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockLocation]);
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(getLocations).mockRejectedValue(
      new ForbiddenError('Caller organization could not be resolved'),
    );
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws unexpectedly', async () => {
    vi.mocked(getLocations).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── POST /org-admin/locations ────────────────────────────────────────────────

describe('POST /org-admin/locations — create', () => {
  const validBody = JSON.stringify({ name: 'Main Office', address: '123 Main St' });

  it('returns 201 with the created location', async () => {
    vi.mocked(createLocation).mockResolvedValue(mockLocation);
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    expect(body(result)).toEqual(mockLocation);
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: '{bad' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(createLocation).mockRejectedValue(new ValidationError('name is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'name is required' });
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    vi.mocked(createLocation).mockRejectedValue(
      new ValidationError('name must be 100 characters or fewer'),
    );
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'name must be 100 characters or fewer' });
  });

  it('returns 400 when address exceeds 200 characters', async () => {
    vi.mocked(createLocation).mockRejectedValue(
      new ValidationError('address must be 200 characters or fewer'),
    );
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'address must be 200 characters or fewer' });
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(createLocation).mockRejectedValue(
      new ForbiddenError('Caller organization could not be resolved'),
    );
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws unexpectedly', async () => {
    vi.mocked(createLocation).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/locations', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /org-admin/locations/{locationId} ────────────────────────────────────

describe('PUT /org-admin/locations/{locationId} — update', () => {
  const updateBody = JSON.stringify({ name: 'Updated Office' });

  it('returns 200 with the updated location', async () => {
    const updated = { ...mockLocation, name: 'Updated Office' };
    vi.mocked(updateLocation).mockResolvedValue(updated);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(updated);
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: '{bad',
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when body has no recognized fields', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: '{}',
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateLocation).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(UpdateOrgAdminLocationBody, {}),
    });
  });

  it('returns 400 when name is empty', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: JSON.stringify({ name: '   ' }),
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateLocation).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(UpdateOrgAdminLocationBody, { name: '   ' }),
    });
  });

  it('returns 404 when location is not found', async () => {
    vi.mocked(updateLocation).mockRejectedValue(new NotFoundError('Location not found'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-unknown' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: 'Location not found' });
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(updateLocation).mockRejectedValue(
      new ForbiddenError('Caller organization could not be resolved'),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws unexpectedly', async () => {
    vi.mocked(updateLocation).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── DELETE /org-admin/locations/{locationId} ─────────────────────────────────

describe('DELETE /org-admin/locations/{locationId} — remove', () => {
  it('returns 200 when location is deleted', async () => {
    vi.mocked(removeLocation).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 when location is not found', async () => {
    vi.mocked(removeLocation).mockRejectedValue(new NotFoundError('Location not found'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: 'Location not found' });
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(removeLocation).mockRejectedValue(
      new ForbiddenError('Caller organization could not be resolved'),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws unexpectedly', async () => {
    vi.mocked(removeLocation).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/locations/{locationId}',
        pathParameters: { locationId: 'loc-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
