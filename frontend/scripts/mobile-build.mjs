#!/usr/bin/env node
/**
 * One command from source to a ready-to-run native project for an environment:
 *   1. npm run build                       (base environment.ts, placeholders intact)
 *   2. scripts/mobile-env.mjs <env>        (replace placeholders with that environment's values)
 *   3. npx cap sync <platform>             (with NODE_ENV=<env> so capacitor.config.ts picks the app id/name)
 *   4. optionally `cap open <platform>`
 *
 *   node scripts/mobile-build.mjs <dev|qa|main> [ios|android|all] [--open]
 *
 * Node is used instead of shell one-liners so this works the same on macOS, Linux and Windows.
 */
import { spawnSync } from 'node:child_process';
import { ENVIRONMENTS, frontendDir } from './mobile-env.mjs';

const PLATFORMS = ['ios', 'android'];
const args = process.argv.slice(2);
const open = args.includes('--open');
const [env, platformArg = 'all'] = args.filter((a) => !a.startsWith('--'));

if (!ENVIRONMENTS.includes(env) || !['all', ...PLATFORMS].includes(platformArg)) {
  console.error('Usage: node scripts/mobile-build.mjs <dev|qa|main> [ios|android|all] [--open]');
  process.exit(1);
}
if (open && platformArg === 'all') {
  console.error('--open needs a single platform (ios or android).');
  process.exit(1);
}

const platforms = platformArg === 'all' ? PLATFORMS : [platformArg];

function step(title, command, commandArgs, extraEnv = {}) {
  console.log(`\n▶ ${title}`);
  const result = spawnSync(command, commandArgs, {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\n✖ Failed: ${title}`);
    process.exit(result.status ?? 1);
  }
}

step('Build web bundle', 'npm', ['run', 'build']);
step(`Replace placeholders (${env})`, 'node', ['scripts/mobile-env.mjs', env]);
for (const platform of platforms) {
  step(`cap sync ${platform} (${env})`, 'npx', ['cap', 'sync', platform], { NODE_ENV: env });
}
if (open) step(`Open ${platforms[0]}`, 'npx', ['cap', 'open', platforms[0]], { NODE_ENV: env });

console.log(`\n✓ ${env} ready for: ${platforms.join(', ')}`);
if (platforms.includes('android')) {
  const flavor = env === 'main' ? 'prod' : env;
  console.log(`  Android: select build variant "${flavor}Debug" in Android Studio (or ./gradlew assemble${flavor[0].toUpperCase()}${flavor.slice(1)}Debug).`);
}
