import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type ManagerResponse = ApiSchema<'OrgAdminManagerResponse'>;
export type CreateManagerBody = ApiSchema<'CreateManagerBody'>;
export type UpdateManagerBody = ApiSchema<'UpdateManagerBody'>;
