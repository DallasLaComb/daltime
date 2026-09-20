import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type Organization = ApiSchema<'WebAdminOrganizationResponse'>;
export type CreateOrganizationBody = ApiSchema<'CreateOrganizationBody'>;
export type UpdateOrganizationBody = ApiSchema<'UpdateOrganizationBody'>;
