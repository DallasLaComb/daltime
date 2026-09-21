import {
  type ManagerShiftNeededResponse,
  CreateManagerShiftNeededBody,
  ManagerShiftNeededQuery,
  UpdateManagerShiftNeededBody,
} from '@daltime/contracts';
import { createShiftCrudHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

const handleRequest = createShiftCrudHandler<ManagerShiftNeededResponse>(
  service,
  'manager shifts-needed handler',
  {
    query: ManagerShiftNeededQuery,
    create: CreateManagerShiftNeededBody,
    update: UpdateManagerShiftNeededBody,
  },
);

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withLogging(withImpersonation(handleRequest), 'manager-shifts-needed');
