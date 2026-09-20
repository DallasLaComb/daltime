import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type ShiftType = ApiSchema<'ShiftType'>;
export type ShiftStatus = ApiSchema<'ShiftStatus'>;
export type Shift = ApiSchema<'ManagerShiftResponse'>;
export type CreateShiftBody = ApiSchema<'CreateManagerShiftBody'>;
export type UpdateShiftBody = ApiSchema<'UpdateManagerShiftBody'>;
