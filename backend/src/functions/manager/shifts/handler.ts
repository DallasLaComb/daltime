import { CreateManagerShiftBody, UpdateManagerShiftBody } from '@daltime/contracts';
import { createShiftCrudHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';

export const handler = createShiftCrudHandler(
  service,
  'manager shifts handler',
  { create: CreateManagerShiftBody, update: UpdateManagerShiftBody },
);

