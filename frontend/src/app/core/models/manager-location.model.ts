import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type ManagerLocation = ApiSchema<'ManagerLocationResponse'>;
export type CreateLocationBody = ApiSchema<'CreateOrgAdminLocationBody'>;
export type UpdateLocationBody = ApiSchema<'UpdateOrgAdminLocationBody'>;
