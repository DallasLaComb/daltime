/**
 * Barrel for the manager role's operation schemas.
 *
 * Each `export *` also runs that module's `registerOperation` calls, so adding a
 * line here is what makes a slice appear in the generated `openapi.json`.
 * Owned by the manager slice work — the root `src/index.ts` re-exports this file, so
 * nothing outside this directory needs editing to add a slice.
 */
export * from './employee-availability.js';
export * from './employees.js';
export * from './locations.js';
export * from './profile.js';
export * from './schedule.js';
export * from './shifts.js';
export * from './shifts-needed.js';
export * from './schedule-templates.js';
