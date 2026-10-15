import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';

export const ISSUER = 'https://gateway.test';
export const AUDIENCE = 'planning-api';
export const KID = 'test-key';

export interface TestTokens {
  keys: JWTVerifyGetKey;
  /** Gateway-shaped token. A claim set to null is left out. */
  sign(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function makeTestTokens(): Promise<TestTokens> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256' };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    async sign(claims = {}, header = {}) {
      const merged: Record<string, unknown> = {
        token_use: 'identity', sid: 'sid-1', sub: 'sub-1', email: 'ana@example.com', name: 'Ana Lim', role: 'user',
        iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300, ...claims,
      };
      const payload = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null));
      return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: KID, ...header }).sign(privateKey);
    },
  };
}
