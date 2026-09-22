// Dev environment configuration
export const environment = {
  name: 'dev',
  production: false,
  cognito: {
    userPoolId: 'us-east-1_kzQ806uSv',
    clientId: '1nl13tbaqb47s8f0tfc07lc24m',
    region: 'us-east-1',
    domain: 'daltime-dev.auth.us-east-1.amazoncognito.com',
  },
  api: {
    baseUrl: 'https://ddy3hzd0ef.execute-api.us-east-1.amazonaws.com',
  },
  posthog: {
    // Do not commit a real key here (see docs/posthog-guide.md) — edit locally and leave unstaged.
    apiKey: '',
    apiHost: 'https://us.i.posthog.com',
    enabled: false,
  },
};
