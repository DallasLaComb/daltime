// Run with: npm run test:scripts   (node's built-in test runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadValues,
  parseEnvFile,
  replacePlaceholders,
  PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
} from './mobile-env.mjs';

const VALUES = {
  API_BASE_URL: 'https://api.example.com',
  COGNITO_USER_POOL_ID: 'us-east-1_ABC123',
  COGNITO_CLIENT_ID: 'client123',
  COGNITO_REGION: 'us-east-1',
  COGNITO_DOMAIN: 'daltime-dev.auth.us-east-1.amazoncognito.com',
};

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'mobile-env-'));
}

function bundle(files) {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const ALL_PLACEHOLDERS = Object.values(PLACEHOLDERS).join(' ');

test('parseEnvFile handles comments, blanks and quotes', () => {
  const parsed = parseEnvFile('# c\n\nA=1\nB="two"\nC=\'three\'\nD = four\n');
  assert.deepEqual(parsed, { A: '1', B: 'two', C: 'three', D: 'four' });
});

test('loadValues fails loudly and lists every missing variable', () => {
  const dir = tempDir();
  try {
    assert.throws(
      () => loadValues('dev', { API_BASE_URL: 'https://x.example.com' }, dir),
      (err) =>
        /Missing required value\(s\) for "dev"/.test(err.message) &&
        ['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'COGNITO_REGION', 'COGNITO_DOMAIN'].every((k) =>
          err.message.includes(k),
        ) &&
        !err.message.includes('API_BASE_URL,'),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadValues reads .env.mobile.<env> and lets real env vars override it', () => {
  const dir = tempDir();
  try {
    writeFileSync(
      join(dir, '.env.mobile.qa'),
      Object.entries(VALUES).map(([k, v]) => `${k}=${v}`).join('\n'),
    );
    const values = loadValues('qa', { COGNITO_REGION: 'eu-west-1' }, dir);
    assert.equal(values.COGNITO_REGION, 'eu-west-1');
    assert.equal(values.API_BASE_URL, VALUES.API_BASE_URL);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadValues does not require POSTHOG_KEY/POSTHOG_HOST and defaults them to empty string', () => {
  const dir = tempDir();
  try {
    const values = loadValues('dev', VALUES, dir);
    assert.equal(values.POSTHOG_KEY, '');
    assert.equal(values.POSTHOG_HOST, '');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadValues reads POSTHOG_KEY/POSTHOG_HOST when set, without requiring them', () => {
  const dir = tempDir();
  try {
    const values = loadValues('dev', { ...VALUES, POSTHOG_KEY: 'phc_abc', POSTHOG_HOST: 'https://eu.i.posthog.com' }, dir);
    assert.equal(values.POSTHOG_KEY, 'phc_abc');
    assert.equal(values.POSTHOG_HOST, 'https://eu.i.posthog.com');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadValues rejects unknown environments and unsafe values', () => {
  const dir = tempDir();
  try {
    assert.throws(() => loadValues('staging', VALUES, dir), /Unknown environment/);
    assert.throws(
      () => loadValues('dev', { ...VALUES, API_BASE_URL: "https://x.com/'; alert(1); '" }, dir),
      /unsupported characters/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('replacePlaceholders replaces html/js/txt files and leaves other files alone', () => {
  const dir = bundle({
    'index.html': `<html>${PLACEHOLDERS.API_BASE_URL}</html>`,
    'main.js': `const e={api:'${PLACEHOLDERS.API_BASE_URL}',pool:'${PLACEHOLDERS.COGNITO_USER_POOL_ID}',c:'${PLACEHOLDERS.COGNITO_CLIENT_ID}',r:'${PLACEHOLDERS.COGNITO_REGION}',d:'${PLACEHOLDERS.COGNITO_DOMAIN}'};`,
    'chunk/x.js': `'${PLACEHOLDERS.API_BASE_URL}'`,
    'notes.css': `/* ${ALL_PLACEHOLDERS} */`,
  });
  try {
    // .css is intentionally not in the replaced set (same as cd.yml), so it must not carry placeholders
    writeFileSync(join(dir, 'notes.css'), '/* nothing */');
    const { filesChanged, replacements } = replacePlaceholders(dir, VALUES);
    assert.equal(filesChanged, 3);
    assert.equal(replacements, 7);
    const main = readFileSync(join(dir, 'main.js'), 'utf8');
    assert.ok(main.includes('https://api.example.com') && main.includes('us-east-1_ABC123'));
    assert.ok(!main.includes('__'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('replacePlaceholders substitutes optional PostHog placeholders too, even with an empty default', () => {
  const dir = bundle({
    'index.html': `<html>${PLACEHOLDERS.API_BASE_URL}</html>`,
    'main.js': `const p={key:'${OPTIONAL_PLACEHOLDERS.POSTHOG_KEY}',host:'${OPTIONAL_PLACEHOLDERS.POSTHOG_HOST}'};`,
  });
  try {
    const values = { ...VALUES, POSTHOG_KEY: '', POSTHOG_HOST: '' };
    replacePlaceholders(dir, values);
    const main = readFileSync(join(dir, 'main.js'), 'utf8');
    assert.equal(main, "const p={key:'',host:''};");
    assert.ok(!main.includes('__'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('replacePlaceholders fails if a placeholder remains (unknown __VITE_ placeholder)', () => {
  const dir = bundle({
    'index.html': `<html>${PLACEHOLDERS.API_BASE_URL}</html>`,
    'main.js': "const x='__VITE_SOMETHING_NEW__';",
  });
  try {
    assert.throws(() => replacePlaceholders(dir, VALUES), /Placeholders remain after replacement[\s\S]*__VITE_SOMETHING_NEW__/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('replacePlaceholders fails when nothing was replaced (already processed bundle)', () => {
  const dir = bundle({ 'index.html': '<html>done</html>', 'main.js': "const a='https://api.example.com';" });
  try {
    assert.throws(() => replacePlaceholders(dir, VALUES), /No placeholders were found/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('replacePlaceholders fails clearly when the bundle is missing', () => {
  assert.throws(() => replacePlaceholders(join(tempDir(), 'nope'), VALUES), /Run "npm run build" first/);
});
