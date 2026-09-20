import { AssignUserLocationBody, type UserLocationResponse } from '@daltime/contracts';
import { createSubEntityLocationsHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';

export const handler = createSubEntityLocationsHandler<UserLocationResponse>(
  service,
  'managerId',
  'org-admin manager-locations handler',
  AssignUserLocationBody,
);
