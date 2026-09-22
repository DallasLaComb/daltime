// Base environment configuration (also used as dev default in CI)
export const environment = {
  name: 'dev',
  production: false,
  cognito: {
    userPoolId: '__VITE_COGNITO_USER_POOL_ID__',
    clientId: '__VITE_COGNITO_CLIENT_ID__',
    region: '__VITE_COGNITO_REGION__',
    domain: '__VITE_COGNITO_DOMAIN__',
  },
  api: {
    baseUrl: '__API_BASE_URL__', // Replaced by pipeline with deployed API Gateway URL
  },
  posthog: {
    // Not secret — this key is designed to ship inside a public web bundle. Empty string (an unset
    // GitHub var) is treated as disabled by PosthogService, so a missing value never breaks a deploy.
    apiKey: '__VITE_POSTHOG_KEY__',
    apiHost: '__VITE_POSTHOG_HOST__',
    enabled: true,
  },
};
