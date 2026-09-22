// Main (production) environment configuration - update values for your prod AWS environment
export const environment = {
  name: 'main',
  production: true,
  cognito: {
    userPoolId: 'us-east-1_7NEt59Aww',
    clientId: '6jrasd3u6dc7g9p4osd4rshn91',
    region: 'us-east-1',
    domain: 'us-east-17net59aww.auth.us-east-1.amazoncognito.com',
  },
  api: {
    baseUrl: '__API_BASE_URL__', // Replaced by pipeline with deployed API Gateway URL
  },
  posthog: {
    apiKey: '__VITE_POSTHOG_KEY__',
    apiHost: '__VITE_POSTHOG_HOST__',
    enabled: true,
  },
};
