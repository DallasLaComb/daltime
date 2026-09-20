import * as z from 'zod';
import { errorResponses } from '../common.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/impersonate/handler.ts',
  'backend/src/functions/web-admin/impersonate/service.ts',
  'backend/src/functions/web-admin/impersonate/db.ts',
];

/**
 * The three roles a WebAdmin may impersonate. Mirrors the Cognito groups the
 * impersonation flow resolves a target user into — see `service.resolveRole`.
 */
export const ImpersonatableRole = z
  .enum(['OrgAdmin', 'Manager', 'Employee'])
  .meta({ id: 'ImpersonatableRole', description: 'A role that can be impersonated.' });

/** Query parameters accepted by `GET /web-admin/impersonate/users`. Both required. */
export const ImpersonateUsersQueryParams = z
  .object({
    orgId: z.string().min(1).meta({ description: 'The organization’s org_id.' }),
    role: ImpersonatableRole.meta({ description: 'Restrict the list to a single role.' }),
  })
  .meta({ id: 'ImpersonateUsersQueryParams' });

/** Path parameters accepted by `GET /web-admin/impersonate/{userId}/context`. */
export const ImpersonateContextPathParams = z
  .object({
    userId: z.string().min(1).meta({ description: 'Cognito sub of the user to impersonate.' }),
  })
  .meta({ id: 'ImpersonateContextPathParams' });

/** One user WebAdmin may impersonate, as returned by the `/users` list. */
export const ImpersonateUserSummary = z
  .object({
    user_id: z.string().meta({ description: 'Cognito sub.' }),
    display_name: z.string().meta({ description: 'Resolved from name or first/last name.' }),
    email: z.string(),
    status: z.string().meta({ description: 'Stored account status (Cognito UserStatus).' }),
    org_id: z.string(),
  })
  .meta({
    id: 'ImpersonateUserSummary',
    description: 'A user available to impersonate within an organization and role.',
  });

export const ImpersonateUserListResponse = z.array(ImpersonateUserSummary).meta({
  id: 'ImpersonateUserListResponse',
  description: 'Every user matching the requested org and role.',
});

/** A target user’s profile plus their resolved role, used to start a session. */
export const ImpersonateContextResponse = z
  .object({
    user_id: z.string().meta({ description: 'Cognito sub.' }),
    role: ImpersonatableRole,
    display_name: z.string(),
    email: z.string(),
    org_id: z.string(),
    status: z.string().meta({ description: 'Stored account status (Cognito UserStatus).' }),
  })
  .meta({
    id: 'ImpersonateContextResponse',
    description: 'The impersonated user’s identity, resolved from DynamoDB + Cognito.',
  });

registerOperation('get', '/web-admin/impersonate/users', {
  operationId: 'listWebAdminImpersonatableUsers',
  summary: 'List users available to impersonate in an organization',
  tags: ['web-admin'],
  purpose:
    'Backs step 3 of the web-admin impersonation picker (frontend/src/app/features/web-admin/impersonate). ' +
    'Lists the org-scoped users of a single role that the calling WebAdmin may then impersonate.',
  implementation: IMPLEMENTATION,
  requestParams: { query: ImpersonateUsersQueryParams },
  dynamodb: [
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, <ROLE>#)',
      note: 'SK prefix is USER# for OrgAdmin, MANAGER# for Manager, EMPLOYEE# for Employee.',
    },
  ],
  responses: {
    200: {
      description: 'Every user matching the requested org and role.',
      content: { 'application/json': { schema: ImpersonateUserListResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('get', '/web-admin/impersonate/{userId}/context', {
  operationId: 'getWebAdminImpersonateContext',
  summary: 'Fetch a user’s context for starting impersonation',
  tags: ['web-admin'],
  purpose:
    'Final step of the impersonation picker: resolves the selected user’s identity and Cognito role, ' +
    'which the frontend stores to rewrite subsequent role-prefixed calls through the impersonation proxy.',
  implementation: IMPLEMENTATION,
  requestParams: { path: ImpersonateContextPathParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<userId> AND SK = METADATA',
      note: 'Reverse-lookup record present for OrgAdmin, Manager, and Employee alike.',
    },
  ],
  responses: {
    200: {
      description: 'The impersonated user’s identity and resolved role.',
      content: { 'application/json': { schema: ImpersonateContextResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

/**
 * Deliberately NOT registered: `GET/POST/PUT/PATCH/DELETE
 * /web-admin/impersonate/{userId}/{proxy+}`.
 *
 * That catch-all is not a call target of its own — `impersonation.interceptor.ts`
 * rewrites role-prefixed requests into it at runtime, and `route-registry.ts`
 * re-dispatches each sub-path to the real role handler already documented under
 * its own route. Enumerating every reachable sub-path here would duplicate ~60
 * existing operations under an impersonate prefix, none of which any call site
 * references by name, at substantial drift risk and zero compile-time benefit.
 * The wire shapes of a proxied call are identical to the real route it forwards
 * to; see the blueprint at
 * backend/src/functions/web-admin/impersonate/0-impersonate.blueprint.md.
 */

export type ImpersonatableRole = z.infer<typeof ImpersonatableRole>;
export type ImpersonateUsersQueryParams = z.infer<typeof ImpersonateUsersQueryParams>;
export type ImpersonateContextPathParams = z.infer<typeof ImpersonateContextPathParams>;
export type ImpersonateUserSummary = z.infer<typeof ImpersonateUserSummary>;
export type ImpersonateUserListResponse = z.infer<typeof ImpersonateUserListResponse>;
export type ImpersonateContextResponse = z.infer<typeof ImpersonateContextResponse>;
