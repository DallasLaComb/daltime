import type { OrganizationRecord } from '@daltime/contracts';

export type { CreateOrganizationBody, UpdateOrganizationBody } from '@daltime/contracts';

/** Organization item stored in DynamoDB. Shape owned by `@daltime/contracts`. */
export type Organization = OrganizationRecord;
