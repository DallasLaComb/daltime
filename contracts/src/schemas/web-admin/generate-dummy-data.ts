import * as z from 'zod';
import { errorResponses } from '../common.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/generate-dummy-data/handler.ts',
  'backend/src/functions/web-admin/generate-dummy-data/service.ts',
  'backend/src/functions/web-admin/generate-dummy-data/db.ts',
];

/**
 * Body accepted by `POST /web-admin/generate-dummy-data`.
 *
 * The date-window rule (current month through +24 months) is runtime logic in
 * `service.validateBody`, so this schema captures only the field/range shape.
 */
export const GenerateDummyDataBody = z
  .object({
    year: z
      .int()
      .min(2020)
      .max(2030)
      .meta({ description: 'Full 4-digit year, 2020–2030.' }),
    month: z.int().min(1).max(12).meta({ description: '1-indexed month (1 = January, 12 = December).' }),
  })
  .meta({
    id: 'GenerateDummyDataBody',
    description: 'Month/year to generate dummy availability + open shifts for.',
  });

/** Response to `POST /web-admin/generate-dummy-data`. */
export const GenerateDummyDataResponse = z
  .object({
    message: z.string().meta({ description: 'Human-readable summary of what was generated.' }),
  })
  .meta({ id: 'GenerateDummyDataResponse' });

registerOperation('post', '/web-admin/generate-dummy-data', {
  operationId: 'generateWebAdminDummyData',
  summary: 'Generate dummy data (dev/test seeding)',
  tags: ['web-admin'],
  purpose:
    'Dev/test helper scoped to the seed org only: generates availability records and open shifts for ' +
    'a requested month. Never touches real customer orgs.',
  implementation: IMPLEMENTATION,
  requestBody: { required: true, content: { 'application/json': { schema: GenerateDummyDataBody } } },
  dynamodb: [
    {
      command: 'Query',
      keyCondition: 'GSI1PK = ORG',
      note: 'Lists orgs, filtered to the seed org id before generation.',
    },
    {
      command: 'BatchWrite',
      keyCondition: 'PK = USER#<employeeId> AND SK = AVAILABILITY',
      note: 'Writes one availability record per (non-zero-availability) employee.',
    },
    {
      command: 'BatchWrite',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Writes the generated open shifts, published and unassigned.',
    },
  ],
  responses: {
    200: {
      description: 'A summary of the generated dummy data.',
      content: { 'application/json': { schema: GenerateDummyDataResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type GenerateDummyDataBody = z.infer<typeof GenerateDummyDataBody>;
export type GenerateDummyDataResponse = z.infer<typeof GenerateDummyDataResponse>;
