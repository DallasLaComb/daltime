/**
 * Barrel for the employee role's operation schemas.
 *
 * Each `export *` also runs that module's `registerOperation` calls, so adding a
 * line here is what makes a slice appear in the generated `openapi.json`.
 * Owned by the employee slice work — the root `src/index.ts` re-exports this file, so
 * nothing outside this directory needs editing to add a slice.
 */
export * from './availability-overrides.js';
export * from './availability.js';
export * from './available-shifts.js';
export * from './profile.js';
export * from './shifts.js';
export * from './swap-shifts.js';
