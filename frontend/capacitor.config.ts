import type { CapacitorConfig } from '@capacitor/cli';

// scripts/mobile-build.mjs sets NODE_ENV to dev | qa | main before `cap sync`.
// Anything else (including unset) is treated as prod so a bare `cap sync` never ships a dev app id.
const APP_BY_ENV: Record<string, { appId: string; appName: string }> = {
  dev: { appId: 'com.daltime.app.dev', appName: 'DalTime Dev' },
  qa: { appId: 'com.daltime.app.qa', appName: 'DalTime QA' },
  main: { appId: 'com.daltime.app', appName: 'DalTime' },
};

const { appId, appName } = APP_BY_ENV[process.env['NODE_ENV'] ?? ''] ?? APP_BY_ENV['main'];

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: 'dist/frontend/browser',
  server: {
    // Android serves from https://localhost. iOS cannot: WKWebView already handles http/https, so Capacitor
    // ignores an https iosScheme and uses capacitor://localhost. Both origins are in the API's AllowedOrigins.
    androidScheme: 'https',
  },
};

export default config;
