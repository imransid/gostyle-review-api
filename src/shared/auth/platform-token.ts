import { createHash } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

/** The issuer gostyle-api signs staff tokens with (booking-api's STAFF_ISSUER). */
export const PLATFORM_ISSUER = 'gostyle-api';

/** Who a verified platform token says the caller is. */
export interface PlatformPrincipal {
  userId: string;
  /** Present for a salon (tenant) context; absent for HQ. Never defaulted. */
  tenantId: string | null;
  /** The staff member's assigned branch, when they have one. */
  branchId: string | null;
  /** 'platform_admin' for HQ, 'tenant_user' for salon staff. */
  actor: string | null;
  roles: string[];
  /** The raw token, to ask the platform for the caller's permissions. */
  token: string;
}

interface Claims {
  sub?: unknown;
  tenantId?: unknown;
  branchId?: unknown;
  actor?: unknown;
  roles?: unknown;
}

export class InvalidTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(reason === 'expired' ? 'Token expired' : 'Invalid token');
  }
}

/**
 * Verify LOCALLY, as booking-api's token-verifier does: HS256, issuer
 * gostyle-api, the same secret. No network call per request for the
 * signature; permissions are a separate question (see PermissionResolver).
 */
export function verifyPlatformToken(token: string, secret: string): PlatformPrincipal {
  let claims: Claims;
  try {
    claims = jwt.verify(token, secret, { issuer: PLATFORM_ISSUER, algorithms: ['HS256'] }) as Claims;
  } catch (e) {
    throw new InvalidTokenError(e instanceof jwt.TokenExpiredError ? 'expired' : 'invalid');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') throw new InvalidTokenError('invalid');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  return {
    userId: claims.sub,
    tenantId: str(claims.tenantId),
    branchId: str(claims.branchId),
    actor: str(claims.actor),
    roles: Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === 'string') : [],
    token,
  };
}

/**
 * A 48-bit digest for comparing two secrets in two boot logs without printing
 * either (booking-api's secretFingerprint). A mismatched secret is otherwise
 * one silent 401 per request.
 */
export function secretFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}
