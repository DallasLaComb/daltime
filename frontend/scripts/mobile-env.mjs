#!/usr/bin/env node
/**
 * Replaces the __PLACEHOLDER__ values in the built web bundle for one environment so the
 * Capacitor shell talks to the right API / Cognito pool. Mirrors the "Replace environment
 * placeholders" step in .github/workflows/cd.yml (same five placeholders, same file types).
 *
 *   node scripts/mobile-env.mjs <dev|qa|main> [--dist <dir>]
 *
 * Values come from environment variables (CI) and, for local runs, from the git-ignored
 * frontend/.env.mobile.<env> file (see .env.mobile.example; `npm run mobile:env:pull:<env>`
 * writes it from the deployed stacks). Real environment variables win over the file.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENVIRONMENTS = ['dev', 'qa', 'main'];

/** env var name -> placeholder in the built bundle (see src/environments/environment.ts) */
export const PLACEHOLDERS = {
  API_BASE_URL: '__API_BASE_URL__',
  COGNITO_USER_POOL_ID: '__VITE_COGNITO_USER_POOL_ID__',
  COGNITO_CLIENT_ID: '__VITE_COGNITO_CLIENT_ID__',
  COGNITO_REGION: '__VITE_COGNITO_REGION__',
  COGNITO_DOMAIN: '__VITE_COGNITO_DOMAIN__',
};

const REPLACED_EXTENSIONS = new Set(['.html', '.js', '.txt']);
const LEFTOVER_PATTERN = /__(?:API_BASE_URL|VITE_[A-Z0-9_]+)__/;
// Values are inlined into JS string literals, so keep them to plain, quote-free text.
const SAFE_VALUE = /^[A-Za-z0-9._:/@%+=?&#~-]+$/;

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const frontendDir = resolve(scriptDir, '..');
export const defaultDistDir = join(frontendDir, 'dist', 'frontend', 'browser');

/** Minimal KEY=VALUE parser (no dependency). Ignores blank lines and # comments. */
export function parseEnvFile(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Resolve the five values for an environment: process env first, then .env.mobile.<env>. */
export function loadValues(env, processEnv = process.env, dir = frontendDir) {
  if (!ENVIRONMENTS.includes(env)) {
    throw new Error(`Unknown environment "${env}". Expected one of: ${ENVIRONMENTS.join(', ')}`);
  }
  const filePath = join(dir, `.env.mobile.${env}`);
  const fromFile = existsSync(filePath) ? parseEnvFile(readFileSync(filePath, 'utf8')) : {};

  const values = {};
  const missing = [];
  for (const key of Object.keys(PLACEHOLDERS)) {
    const value = processEnv[key] || fromFile[key];
    if (value) values[key] = value;
    else missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required value(s) for "${env}": ${missing.join(', ')}.\n` +
        `Set them as environment variables or in frontend/.env.mobile.${env} ` +
        `(see .env.mobile.example, or run: npm run mobile:env:pull:${env}).`,
    );
  }
  for (const [key, value] of Object.entries(values)) {
    if (!SAFE_VALUE.test(value)) {
      throw new Error(`Value for ${key} contains unsupported characters (quotes, spaces or backslashes).`);
    }
  }
  return values;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/**
 * Replace placeholders in-place, then fail if any remain anywhere in the checked file types.
 * Returns { filesChanged, replacements }.
 */
export function replacePlaceholders(distDir, values) {
  if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
    throw new Error(`No built web bundle found at ${distDir} (index.html missing). Run "npm run build" first.`);
  }

  let filesChanged = 0;
  let replacements = 0;
  const leftovers = [];

  for (const file of walk(distDir)) {
    if (!REPLACED_EXTENSIONS.has(extname(file))) continue;
    const original = readFileSync(file, 'utf8');
    let updated = original;
    for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) {
      const parts = updated.split(placeholder);
      if (parts.length > 1) {
        replacements += parts.length - 1;
        updated = parts.join(values[key]);
      }
    }
    if (updated !== original) {
      writeFileSync(file, updated);
      filesChanged += 1;
    }
    const leftover = updated.match(LEFTOVER_PATTERN);
    if (leftover) leftovers.push(`${file} (${leftover[0]})`);
  }

  if (leftovers.length > 0) {
    throw new Error(`Placeholders remain after replacement:\n  ${leftovers.join('\n  ')}`);
  }
  if (replacements === 0) {
    throw new Error(
      'No placeholders were found to replace. Was the bundle already processed, or built with a ' +
        'different configuration? Rebuild with "npm run build" and try again.',
    );
  }
  return { filesChanged, replacements };
}

export function run(argv = process.argv.slice(2)) {
  const env = argv.find((arg) => !arg.startsWith('--'));
  const distFlag = argv.indexOf('--dist');
  const distDir = distFlag !== -1 ? resolve(argv[distFlag + 1]) : defaultDistDir;
  if (!env) {
    throw new Error('Usage: node scripts/mobile-env.mjs <dev|qa|main> [--dist <dir>]');
  }
  const values = loadValues(env);
  const { filesChanged, replacements } = replacePlaceholders(distDir, values);
  console.log(`✓ ${env}: ${replacements} placeholder(s) replaced in ${filesChanged} file(s)`);
  console.log(`  API: ${values.API_BASE_URL}  |  Cognito pool: ${values.COGNITO_USER_POOL_ID}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
