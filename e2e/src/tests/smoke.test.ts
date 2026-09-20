import { describe, it, expect } from 'vitest';
import { fetch } from 'undici';
import { config } from '../config.js';
import { getCognitoToken } from '../auth.js';

describe('smoke', () => {
  it('frontend is reachable', async () => {
    const res = await fetch(config.frontendBaseUrl);
    expect(res.status).toBe(200);
  }, 15_000);

  it('can authenticate as robot-dev@daltime.com', async () => {
    const token = await getCognitoToken('robot-dev@daltime.com');
    expect(token.length).toBeGreaterThan(0);
  }, 15_000);
});
