import type { EmployeeRecord } from '@daltime/contracts';

export type { CreateEmployeeBody, UpdateEmployeeBody } from '@daltime/contracts';

/** Employee item stored in DynamoDB. Shape owned by `@daltime/contracts`. */
export type Employee = EmployeeRecord;
