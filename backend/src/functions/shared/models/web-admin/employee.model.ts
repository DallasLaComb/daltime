import type { EmployeeRecord, WebAdminEmployeeResponse as Response } from '@daltime/contracts';

/** Employee item as the web-admin sees it (no manager). Shape owned by `@daltime/contracts`. */
export type WebAdminEmployee = Omit<EmployeeRecord, 'manager_id'>;

export type WebAdminEmployeeResponse = Response;
