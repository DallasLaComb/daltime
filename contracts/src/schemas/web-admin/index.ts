/**
 * Barrel for the web-admin role's operation schemas.
 *
 * Each `export *` also runs that module's `registerOperation` calls, so adding a
 * line here is what makes a slice appear in the generated `openapi.json`.
 * Owned by the web-admin slice work — the root `src/index.ts` re-exports this file, so
 * nothing outside this directory needs editing to add a slice.
 */
export * from './employees.js';
export * from './generate-dummy-data.js';
export * from './impersonate.js';
export * from './org-admins.js';
export * from './organizations.js';
export * from './profile.js';
