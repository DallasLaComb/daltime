import type { ManagerRecord } from '@daltime/contracts';

export type { CreateManagerBody, UpdateManagerBody } from '@daltime/contracts';

/** Manager item stored in DynamoDB. Shape owned by `@daltime/contracts`. */
export type Manager = ManagerRecord;
