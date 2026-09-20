#!/usr/bin/env node
/**
 * `npm run contracts:sync` — one command to run after ANY contract edit.
 *
 * Runs the full contract propagation chain and stops at the first failure:
 *
 *   1. contracts: build + generate (Zod schemas → contracts/openapi.json)
 *      + check:routes (every infra/template.yaml route ↔ an openapi.json operation)
 *   2. backend:   sync-contracts   (built package → backend/vendor/contracts)
 *   3. backend:   tsc --noEmit     (catches handlers broken by a shape change)
 *      + typecheck:tests        (catches test fixtures broken by it — vitest never checks types)
 *   4. frontend:  contracts:types  (openapi.json → core/generated/api.d.ts)
 *   5. frontend:  ng build         (catches components/services broken by it)
 *
 * Why a script instead of three npm commands from memory: this chain is run
 * dozens of times per migration wave, and skipping step 3 or 5 is how shape
 * changes reach prod with a "the types matched" false confidence. Both
 * typechecks passing = frontend and backend agree on the shape. That is the
 * entire value of the contracts system.
 *
 * Runs from the repo root regardless of where it's invoked:
 *   node contracts/scripts/contracts-sync.mjs
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  { label: 'contracts: build + generate openapi.json', dir: 'contracts', cmd: [npm, ['run', 'generate']] },
  { label: 'contracts: template routes match openapi.json', dir: 'contracts', cmd: [npm, ['run', 'check:routes']] },
  { label: 'backend: sync vendored contracts', dir: 'backend', cmd: [npm, ['run', 'contracts:build']] },
  { label: 'backend: typecheck (tsc --noEmit)', dir: 'backend', cmd: ['npx', ['tsc', '--noEmit']] },
  { label: 'backend: typecheck tests (fixtures vs contract types)', dir: 'backend', cmd: [npm, ['run', 'typecheck:tests']] },
  { label: 'frontend: generate api.d.ts', dir: 'frontend', cmd: [npm, ['run', 'contracts:types']] },
  { label: 'frontend: typecheck (ng build)', dir: 'frontend', cmd: ['npx', ['ng', 'build']] },
];

for (const step of steps) {
  const cwd = resolve(repoRoot, step.dir);
  console.log(`\n[contracts:sync] ${step.label}…`);
  try {
    execFileSync(step.cmd[0], step.cmd[1], { cwd, stdio: 'inherit' });
  } catch {
    console.error(`\n[contracts:sync] ✗ FAILED at: ${step.label}`);
    console.error(`[contracts:sync] Fix the errors above, then rerun. Later steps were skipped.`);
    process.exit(1);
  }
}

console.log(`\n[contracts:sync] ✓ frontend and backend agree on the contract shapes.`);
