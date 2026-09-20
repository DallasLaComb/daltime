import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type ShiftNeeded = ApiSchema<'ManagerShiftNeededResponse'>;
export type CreateShiftBody = ApiSchema<'CreateManagerShiftNeededBody'>;
export type UpdateShiftBody = ApiSchema<'UpdateManagerShiftNeededBody'>;
