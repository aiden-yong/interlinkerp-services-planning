import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { TokenInvalid, TokenVerifier } from './tokens';

let tokens: TestTokens;
let verifier: TokenVerifier;

beforeAll(async () => {
  tokens = await makeTestTokens();
  verifier = new TokenVerifier(tokens.keys, ISSUER, AUDIENCE);
});

describe('TokenVerifier', () => {
  it('returns the claims of a valid identity token', async () => {
    expect((await verifier.verify(await tokens.sign(), 'identity')).email).toBe('ana@example.com');
  });

  it('refuses an access token where an identity token is expected (token_use)', async () => {
    await expect(verifier.verify(await tokens.sign({ token_use: 'access' }), 'identity')).rejects.toThrow('Expected a "identity" token, got "access".');
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1000) - 10 }, {}],
    ['wrong issuer', { iss: 'https://evil.test' }, {}],
    ['wrong audience', { aud: 'other-api' }, {}],
    ['no expiry', { exp: null }, {}],
    ['unknown key', {}, { kid: 'other' }],
  ])('refuses a token with %s', async (_label, claims, header) => {
    await expect(verifier.verify(await tokens.sign(claims, header), 'identity')).rejects.toBeInstanceOf(TokenInvalid);
  });

  it('refuses a tampered payload and garbage', async () => {
    const [h, , s] = (await tokens.sign()).split('.');
    const forged = Buffer.from(JSON.stringify({ token_use: 'identity', role: 'admin' })).toString('base64url');
    await expect(verifier.verify(`${h}.${forged}.${s}`, 'identity')).rejects.toBeInstanceOf(TokenInvalid);
    await expect(verifier.verify('abc', 'identity')).rejects.toBeInstanceOf(TokenInvalid);
  });
});
