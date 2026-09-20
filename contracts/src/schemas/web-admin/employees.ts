import * as z from 'zod';
import { errorResponses } from '../common.js';
import { WebAdminEmployeeApiFields } from '../../entities/employee.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/employees/handler.ts',
  'backend/src/functions/web-admin/employees/service.ts',
  'backend/src/functions/web-admin/employees/db.ts',
];

/** An employee as web-admin sees them: cross-org, with the owning org's name joined in. */
export const WebAdminEmployeeResponse = WebAdminEmployeeApiFields.meta({
  id: 'WebAdminEmployeeResponse',
  description: 'An employee across all organizations, with the owning organization’s name.',
});

export const WebAdminEmployeeListResponse = z.array(WebAdminEmployeeResponse).meta({
  id: 'WebAdminEmployeeListResponse',
  description: 'Every employee across all organizations.',
});

registerOperation('get', '/web-admin/employees', {
  operationId: 'listWebAdminEmployees',
  summary: 'List every employee across all organizations',
  tags: ['web-admin'],
  purpose:
    'Backs the web-admin cross-org employee inventory screen. Lists every employee in every ' +
    'organization, joining each row’s org name from the ORG METADATA record.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Query',
      keyCondition: 'GSI1PK = EMPLOYEE',
      note: 'GSI1 query returns every employee record across all orgs (cross-org inventory view).',
    },
    {
      command: 'BatchGet',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Batch-fetches each distinct org’s name to join as org_name.',
    },
  ],
  responses: {
    200: {
      description: 'Every employee across all organizations.',
      content: { 'application/json': { schema: WebAdminEmployeeListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type WebAdminEmployeeResponse = z.infer<typeof WebAdminEmployeeResponse>;
export type WebAdminEmployeeListResponse = z.infer<typeof WebAdminEmployeeListResponse>;
