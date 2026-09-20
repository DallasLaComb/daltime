import {
  type ManagerShiftNeededResponse,
  CreateManagerShiftNeededBody,
  ManagerShiftNeededQuery,
  UpdateManagerShiftNeededBody,
} from '@daltime/contracts';
import { createShiftCrudHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';

export const handler = createShiftCrudHandler<ManagerShiftNeededResponse>(
  service,
  'manager shifts-needed handler',
  {
    query: ManagerShiftNeededQuery,
    create: CreateManagerShiftNeededBody,
    update: UpdateManagerShiftNeededBody,
  },
);
