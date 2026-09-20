/**
 * Barrel for the shared role's operation schemas.
 *
 * Each `export *` also runs that module's `registerOperation` calls, so adding a
 * line here is what makes a slice appear in the generated `openapi.json`.
 * Owned by the shared slice work — the root `src/index.ts` re-exports this file, so
 * nothing outside this directory needs editing to add a slice.
 */
export * from './health.js';
export * from './notifications.js';
