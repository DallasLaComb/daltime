/**
 * `@daltime/contracts` — the single source of truth for every DalTime API
 * request/response shape.
 *
 * Adding a slice means creating `src/schemas/<role>/<feature>.ts` and adding it
 * to the side-effect import block below. Anything not imported here is invisible
 * to both the generated `openapi.json` and the frontend's generated types.
 */

// ── Public API ───────────────────────────────────────────────────────────────
export * from './schemas/common.js';

// One barrel per role. Re-exporting a barrel also runs its modules'
// `registerOperation` calls, which is what puts a slice into `openapi.json`.
// Adding a slice means editing only that role's barrel, never this file.
export * from './schemas/employee/index.js';
export * from './schemas/manager/index.js';
export * from './schemas/org-admin/index.js';
export * from './schemas/web-admin/index.js';
export * from './schemas/shared/index.js';

// Stored DynamoDB item shapes. These replace `backend/src/functions/shared/models/`
// and are not registered as operations — they describe the table, not the wire.
export * from './entities/keys.js';
export * from './entities/availability.js';
export * from './entities/employee.js';
export * from './entities/location.js';
export * from './entities/manager.js';
export * from './entities/notification.js';
export * from './entities/organization.js';
export * from './entities/shift.js';
export * from './entities/swap-shift.js';
export * from './entities/web-admin.js';

export {
  registerOperation,
  registerRoleOperation,
  getRegisteredPaths,
  getRegisteredOperationCount,
  noDynamoAccess,
} from './registry.js';
export type { DynamoAccess, HttpMethod, OperationMetadata } from './registry.js';

/**
 * Re-exported so the backend imports Zod *through* this package rather than
 * depending on it directly. That guarantees exactly one copy of Zod at runtime —
 * two copies would break `instanceof ZodError` in the handler error mapper.
 */
export * as z from 'zod';
export { ZodError } from 'zod';
