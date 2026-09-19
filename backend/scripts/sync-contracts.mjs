/**
 * Builds @daltime/contracts and mirrors the result into `backend/vendor/contracts`.
 *
 * Why this exists
 * ---------------
 * The contract source lives at the repo root (`contracts/`), but SAM's
 * NodejsNpmEsbuildBuilder copies only the function's CodeUri — `backend/` — into
 * a scratch directory and runs `npm install` there. A dependency declared as
 * `file:../contracts` dangles in that scratch copy, and esbuild fails with
 * "Could not resolve @daltime/contracts".
 *
 * Mirroring the built package to `backend/vendor/contracts` puts it inside the
 * CodeUri, so it is copied along with everything else and resolves normally.
 * `backend/package.json` therefore depends on `file:vendor/contracts`.
 *
 * `vendor/` is a build artifact and is gitignored — `contracts/` remains the
 * only place contract source is edited.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = resolve(backendDir, '..', 'contracts');
const vendorDir = resolve(backendDir, 'vendor', 'contracts');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(resolve(contractsDir, 'node_modules'))) {
  console.error(
    `[sync-contracts] ${contractsDir}/node_modules is missing. Run 'npm ci' in contracts/ first.`,
  );
  process.exit(1);
}

console.log('[sync-contracts] building @daltime/contracts…');
execFileSync(npm, ['run', 'build'], { cwd: contractsDir, stdio: 'inherit' });

const source = JSON.parse(readFileSync(resolve(contractsDir, 'package.json'), 'utf8'));

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });
cpSync(resolve(contractsDir, 'dist'), resolve(vendorDir, 'dist'), { recursive: true });

// A minimal manifest: just enough for npm to install it and for Node/esbuild to
// resolve it. Scripts are dropped so `npm install` never tries to rebuild here.
const manifest = {
  name: source.name,
  version: source.version,
  private: true,
  type: source.type,
  main: source.main,
  types: source.types,
  exports: source.exports,
  dependencies: source.dependencies,
};

writeFileSync(resolve(vendorDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`[sync-contracts] wrote ${vendorDir}`);
