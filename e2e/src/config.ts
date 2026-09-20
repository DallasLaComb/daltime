function env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  frontendBaseUrl: env('FRONTEND_BASE_URL'),
  apiBaseUrl: env('API_BASE_URL'),
  cognitoClientId: env('COGNITO_CLIENT_ID'),
  cognitoUserPoolId: env('COGNITO_USER_POOL_ID'),
  cognitoRegion: env('COGNITO_REGION'),
  seedUserPassword: env('E2E_SEED_USER_PASSWORD'),
};
