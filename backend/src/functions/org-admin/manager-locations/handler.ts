import { AssignUserLocationBody } from '@daltime/contracts';
import { createSubEntityLocationsHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';

export const handler = createSubEntityLocationsHandler(
  service,
  'managerId',
  'org-admin manager-locations handler',
  AssignUserLocationBody,
);
