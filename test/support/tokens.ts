import * as jwt from 'jsonwebtoken';

export function platformToken(
  secret: string,
  claims: { sub: string; tenantId?: string; branchId?: string | null; actor?: string; roles?: string[] },
  opts: { issuer?: string; expiresIn?: number } = {},
): string {
  return jwt.sign({ roles: [], ...claims }, secret, {
    issuer: opts.issuer ?? 'gostyle-api',
    expiresIn: opts.expiresIn ?? 900,
    algorithm: 'HS256',
  });
}
