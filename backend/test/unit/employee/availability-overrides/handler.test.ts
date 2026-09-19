/**
 * Unit tests for the employee availability-overrides handler.
 *
 * As with the weekly availability route, the behaviour that is new with the
 * OpenAPI contract migration is request validation: the body is parsed with
 * `UpsertOverridesBody` — the schema that generates this route's entry in
 * `contracts/openapi.json` — so an invalid override map is rejected with a 400
 * before the service runs. That includes the `YYYY-MM-DD` key pattern, which
 * the contract now states as strictly as the service enforces it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../../src/functions/employee/availability-overrides/service.js', () => ({
  getAvailabilityOverrides: vi.fn(),
  upsertAvailabilityOverrides: vi.fn(),
}));

import { handler } from '../../../../src/functions/employee/availability-overrides/handler.js';
import {
  getAvailabilityOverrides,
  upsertAvailabilityOverrides,
} from '../../../../src/functions/employee/availability-overrides/service.js';

function buildEvent(method: string, body?: string): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    rawPath: '/employee/availability/overrides',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'emp-sub-aaa' }, scopes: null } },
      http: { method, path: '/employee/availability/overrides' },
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters: {},
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parsedBody(result: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(result.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OPTIONS /employee/availability/overrides', () => {
  it('returns 200 without calling the service', async () => {
    const result = (await handler(buildEvent('OPTIONS'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(getAvailabilityOverrides).not.toHaveBeenCalled();
  });
});

describe('GET /employee/availability/overrides', () => {
  it('returns the saved overrides', async () => {
    const saved = {
      employee_id: 'emp-sub-aaa',
      org_id: 'org-sunset',
      overrides: { '2026-05-27': { available: false } },
      updated_at: '2026-02-23T18:04:11.000Z',
    };
    vi.mocked(getAvailabilityOverrides).mockResolvedValue(saved);

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual(saved);
  });

  it('returns {} rather than 404 when no overrides exist yet', async () => {
    vi.mocked(getAvailabilityOverrides).mockResolvedValue(null);

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual({});
  });

  it('returns 500 when the service throws an unexpected error', async () => {
    vi.mocked(getAvailabilityOverrides).mockRejectedValue(new Error('DynamoDB transient error'));

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });
});

describe('PUT /employee/availability/overrides — contract validation', () => {
  it('passes a contract-valid body through to the service', async () => {
    const overrides = {
      '2026-05-27': { available: true, slots: [{ from: '09:00', to: '17:00' }], max_shifts: 1 },
    };
    vi.mocked(upsertAvailabilityOverrides).mockResolvedValue({ overrides });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ overrides })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(upsertAvailabilityOverrides).toHaveBeenCalledWith('emp-sub-aaa', { overrides });
  });

  it('accepts an empty override map — clearing every override is a valid save', async () => {
    vi.mocked(upsertAvailabilityOverrides).mockResolvedValue({ overrides: {} });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ overrides: {} })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
  });

  it('returns 400 when the body is absent', async () => {
    const result = (await handler(buildEvent('PUT'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const result = (await handler(
      buildEvent('PUT', '{bad json'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });

  it('returns 400 when overrides is missing entirely', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({})),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });

  it('returns 400 for a key that is not a calendar date, before DynamoDB is touched', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ overrides: { '2026-13-45': { available: false } } })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });

  it('returns 400 for a key that is not a date at all', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ overrides: { tomorrow: { available: false } } })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });

  it('returns 400 for a slot time that is not HH:MM', async () => {
    const overrides = {
      '2026-05-27': { available: true, slots: [{ from: '09:00', to: '99:99' }], max_shifts: 1 },
    };

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ overrides })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailabilityOverrides).not.toHaveBeenCalled();
  });
});

describe('PUT /employee/availability/overrides — unhandled methods', () => {
  it('returns 400 for a method the route does not define', async () => {
    const result = (await handler(buildEvent('DELETE'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });
});
