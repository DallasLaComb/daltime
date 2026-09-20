import * as z from 'zod';
import { errorResponses } from '../common.js';
import { LocationApiFields } from '../../entities/location.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/locations/handler.ts',
  'backend/src/functions/manager/locations/service.ts',
  'backend/src/functions/manager/locations/db.ts',
];

export const ManagerLocationResponse = LocationApiFields.meta({
  id: 'ManagerLocationResponse',
  description: 'A location the calling manager can schedule shifts at.',
});

export const ManagerLocationListResponse = z.array(ManagerLocationResponse).meta({
  id: 'ManagerLocationListResponse',
  description: 'Every location in the calling manager’s organization.',
});

registerRoleOperation('get', '/manager/locations', {
  operationId: 'listManagerLocations',
  summary: "List the calling manager's locations",
  tags: ['manager'],
  purpose:
    'Backs the manager shifts-needed and schedule screens, which need the org’s locations to scope ' +
    'shifts. Resolves the caller’s org_id from their JWT sub and lists every location in that org.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, LOCATION#)',
      note: 'Lists the org’s locations. Key attributes are stripped from each row before responding.',
    },
  ],
  responses: {
    200: {
      description: 'Every location in the manager’s organization.',
      content: { 'application/json': { schema: ManagerLocationListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type ManagerLocationResponse = z.infer<typeof ManagerLocationResponse>;
export type ManagerLocationListResponse = z.infer<typeof ManagerLocationListResponse>;
