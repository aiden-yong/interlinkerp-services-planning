import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export class TokenInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInvalid';
  }
}

function describe(error: unknown): string {
  if (error instanceof errors.JWTExpired) return 'Token has expired.';
  if (error instanceof errors.JWTClaimValidationFailed) return `Token claim "${error.claim}" is not valid.`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'Signature does not verify.';
  if (error instanceof errors.JWKSNoMatchingKey) return "No matching key in the gateway's key set.";
  if (error instanceof errors.JOSEAlgNotAllowed) return 'Unexpected algorithm.';
  return 'Malformed or unverifiable token.';
}

/**
 * Contract SS-25, auth guide §3. jose checks the RS256 signature against the
 * gateway's JWKS plus exp, iss and aud; this class adds token_use, which is
 * what stops an identity token being used as an access token and vice versa.
 */
export class TokenVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async verify(token: string, expectedUse: 'identity' | 'access'): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer.replace(/\/+$/, ''),
        audience: this.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
      }));
    } catch (error) {
      throw new TokenInvalid(describe(error));
    }
    if (payload.token_use !== expectedUse) {
      throw new TokenInvalid(`Expected a "${expectedUse}" token, got "${String(payload.token_use ?? 'none')}".`);
    }
    return payload;
  }
}
