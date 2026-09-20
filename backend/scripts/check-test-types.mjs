#!/usr/bin/env node
/**
 * `npm run typecheck:tests` — type-check `src/` AND `test/` against a ratcheted baseline.
 *
 * `tsc` (tsconfig.json) only covers `src/`, and vitest strips types without checking
 * them, so test fixtures could drift from the contract types with nothing noticing.
 * Fixing the pre-existing fixture errors in one go would be a large, noisy change, so
 * they are recorded in `scripts/test-types-baseline.json` and this script enforces a
 * ratchet instead:
 *
 *   - a NEW error (any file/code count above its baseline) fails the run;
 *   - an improvement is reported so the baseline can be tightened with `--update`.
 *
 * The baseline is keyed by file + TS error code (not line number) so unrelated edits
 * that shift lines do not cause false failures.
 *
 *   node scripts/check-test-types.mjs            # check
 *   node scripts/check-test-types.mjs --update   # rewrite the baseline (only ever shrink it)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(backendDir, 'scripts/test-types-baseline.json');

const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.test.json', '--pretty', 'false'], {
  cwd: backendDir,
  encoding: 'utf8',
});
const output = `${tsc.stdout}${tsc.stderr}`;

// e.g. "test/unit/x.test.ts(12,5): error TS2345: ..."
const counts = {};
const unparsed = [];
for (const line of output.split('\n')) {
  if (!/error TS\d+/.test(line)) continue;
  const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+):/);
  if (!m) {
    unparsed.push(line);
    continue;
  }
  const [, file, code] = m;
  counts[file] ??= {};
  counts[file][code] = (counts[file][code] ?? 0) + 1;
}

if (unparsed.length) {
  console.error('[typecheck:tests] ✗ tsc reported errors this script cannot attribute to a file:');
  console.error(unparsed.join('\n'));
  process.exit(1);
}

const total = (c) => Object.values(c).reduce((n, codes) => n + Object.values(codes).reduce((a, b) => a + b, 0), 0);
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

if (process.argv.includes('--update')) {
  const sorted = sortObj(Object.fromEntries(Object.entries(counts).map(([f, c]) => [f, sortObj(c)])));
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`[typecheck:tests] baseline written: ${total(counts)} known errors in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const regressions = [];
const improvements = [];
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  for (const code of new Set([...Object.keys(counts[file] ?? {}), ...Object.keys(baseline[file] ?? {})])) {
    const now = counts[file]?.[code] ?? 0;
    const was = baseline[file]?.[code] ?? 0;
    if (now > was) regressions.push(`${file}  ${code}: ${was} → ${now}`);
    else if (now < was) improvements.push(`${file}  ${code}: ${was} → ${now}`);
  }
}

if (regressions.length) {
  console.error(`[typecheck:tests] ✗ NEW type errors (baseline allows ${total(baseline)}, found ${total(counts)}):\n  ${regressions.join('\n  ')}`);
  console.error('\nRun `npx tsc -p tsconfig.test.json` to see them. Fix the code/fixture; do not raise the baseline.');
  process.exit(1);
}
if (improvements.length) {
  console.log(`[typecheck:tests] ✓ no new errors. ${improvements.length} entries improved — tighten the baseline:\n  ${improvements.join('\n  ')}\n  run: npm run typecheck:tests -- --update`);
} else {
  console.log(`[typecheck:tests] ✓ no new errors (${total(counts)} known, tracked in scripts/test-types-baseline.json).`);
}
