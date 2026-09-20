import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type EmployeeResponse = ApiSchema<'OrgAdminEmployeeResponse'>;
export type CreateEmployeeBody = ApiSchema<'CreateEmployeeBody'>;
export type UpdateEmployeeBody = ApiSchema<'UpdateEmployeeBody'>;
