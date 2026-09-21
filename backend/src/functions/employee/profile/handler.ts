import { UpdateEmployeeProfileBody, type EmployeeProfileResponse } from '@daltime/contracts';
import { createProfileHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

const handleRequest = createProfileHandler<EmployeeProfileResponse>(
  service,
  'employee profile handler',
  'Employee',
  UpdateEmployeeProfileBody,
);

export const handler = withLogging(withImpersonation(handleRequest), 'employee-profile');
