import { AssignUserLocationBody, type UserLocationResponse } from '@daltime/contracts';
import { createSubEntityLocationsHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';
import { withImpersonation } from '../../shared/impersonation.js';

const handleRequest = createSubEntityLocationsHandler<UserLocationResponse>(
  service,
  'employeeId',
  'org-admin employee-locations handler',
  AssignUserLocationBody,
);

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
