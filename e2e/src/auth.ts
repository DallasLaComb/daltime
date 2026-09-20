import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from './config.js';

export async function getCognitoToken(email: string): Promise<string> {
  const client = new CognitoIdentityProviderClient({ region: config.cognitoRegion });
  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.cognitoClientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: config.seedUserPassword,
      },
    }),
  );
  const token = result.AuthenticationResult?.IdToken;
  if (!token) throw new Error('No IdToken in Cognito response');
  return token;
}
