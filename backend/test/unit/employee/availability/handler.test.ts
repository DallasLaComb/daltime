/**
 * Unit tests for the employee availability handler.
 *
 * The behaviour under test that is new with the OpenAPI contract migration is
 * request validation: `PUT /employee/availability` now parses its body with
 * `UpsertAvailabilityBody` — the very schema that generates this route's entry
 * in `contracts/openapi.json` — so a body the published contract calls invalid
 * is rejected with a 400 before the service (and therefore DynamoDB) is reached.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

vi.mock('../../../../src/functions/employee/availability/service.js', () => ({
  getAvailability: vi.fn(),
  upsertAvailability: vi.fn(),
}));

import { handler } from '../../../../src/functions/employee/availability/handler.js';
import {
  getAvailability,
  upsertAvailability,
} from '../../../../src/functions/employee/availability/service.js';
import { ValidationError } from '../../../../src/functions/shared/errors.js';

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** A full week the contract accepts — every day present, as the service requires. */
function fullSchedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const schedule: Record<string, unknown> = {};
  for (const day of DAYS) schedule[day] = { available: false };
  return { ...schedule, ...overrides };
}

function buildEvent(method: string, body?: string): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    rawPath: '/employee/availability',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'emp-sub-aaa' }, scopes: null } },
      http: { method, path: '/employee/availability' },
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

describe('OPTIONS /employee/availability', () => {
  it('returns 200 without calling the service', async () => {
    const result = (await handler(buildEvent('OPTIONS'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(getAvailability).not.toHaveBeenCalled();
  });
});

describe('GET /employee/availability', () => {
  it('returns the saved availability', async () => {
    const saved = {
      employee_id: 'emp-sub-aaa',
      org_id: 'org-sunset',
      schedule: fullSchedule(),
      updated_at: '2026-02-23T18:04:11.000Z',
    };
    vi.mocked(getAvailability).mockResolvedValue(saved);

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual(saved);
  });

  it('returns {} rather than 404 when the employee has never saved a schedule', async () => {
    vi.mocked(getAvailability).mockResolvedValue(null);

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual({});
  });

  it('returns 500 when the service throws an unexpected error', async () => {
    vi.mocked(getAvailability).mockRejectedValue(new Error('DynamoDB transient error'));

    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });
});

describe('PUT /employee/availability — contract validation', () => {
  it('passes a contract-valid body through to the service', async () => {
    const schedule = fullSchedule({
      monday: { available: true, slots: [{ from: '09:00', to: '17:00' }], max_shifts: 1 },
    });
    vi.mocked(upsertAvailability).mockResolvedValue({ schedule });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(upsertAvailability).toHaveBeenCalledWith('emp-sub-aaa', { schedule });
  });

  it('returns 400 when the body is absent', async () => {
    const result = (await handler(buildEvent('PUT'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const result = (await handler(
      buildEvent('PUT', '{bad json'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 when schedule is missing entirely', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({})),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 when a day of the week is missing — the schedule is a full replace', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule: { monday: { available: false } } })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 for a slot time that is not HH:MM, before DynamoDB is touched', async () => {
    const schedule = fullSchedule({
      tuesday: { available: true, slots: [{ from: '25:00', to: '17:00' }], max_shifts: 1 },
    });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-integer max_shifts', async () => {
    const schedule = fullSchedule({
      wednesday: { available: true, slots: [{ from: '09:00', to: '17:00' }], max_shifts: 1.5 },
    });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(upsertAvailability).not.toHaveBeenCalled();
  });

  it('names the offending field in the 400 body', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule: { monday: { available: 'yes' } } })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect((parsedBody(result) as { error: string }).error).toMatch(/monday/);
  });

  it('still surfaces the service’s own cross-field rules as a 400', async () => {
    const schedule = fullSchedule({
      // Schema-valid (slots is optional) but rejected by the service, which
      // requires a non-empty slots array when available is true.
      friday: { available: true },
    });
    vi.mocked(upsertAvailability).mockRejectedValue(
      new ValidationError('schedule.friday.slots must be a non-empty array when available is true'),
    );

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ schedule })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });
});

describe('PUT /employee/availability — unhandled methods', () => {
  it('returns 400 for a method the route does not define', async () => {
    const result = (await handler(buildEvent('DELETE'))) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });
});
