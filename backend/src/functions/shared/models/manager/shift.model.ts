import type { ShiftRecord } from '@daltime/contracts';

export type { ShiftType, ShiftStatus } from '@daltime/contracts';

/** Shift item stored in DynamoDB. Shape owned by `@daltime/contracts`. */
export type Shift = ShiftRecord;
