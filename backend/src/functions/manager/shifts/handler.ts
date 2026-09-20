import {
  type ManagerShiftResponse,
  CreateManagerShiftBody,
  ManagerShiftsQuery,
  UpdateManagerShiftBody,
} from '@daltime/contracts';
import { createShiftCrudHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';
import { withImpersonation } from '../../shared/impersonation.js';

const handleRequest = createShiftCrudHandler<ManagerShiftResponse>(
  service,
  'manager shifts handler',
  { query: ManagerShiftsQuery, create: CreateManagerShiftBody, update: UpdateManagerShiftBody },
);

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
