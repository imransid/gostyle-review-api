import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DependencyUnavailableError } from '../../review/domain/ports/contact-directory.port';
import { AppConfig } from '../config/app-config';
import type { PlatformPrincipal } from './platform-token';

export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');

/** The caller's effective permission codes, as the platform resolves them. */
export interface PermissionResolver {
  /** Null when the platform refuses the token itself (revoked session, inactive user). */
  permissionsOf(principal: PlatformPrincipal): Promise<string[] | null>;
}

/**
 * Asks gostyle-api who the caller is allowed to be, with THE CALLER'S OWN
 * TOKEN, through GET /v1/auth/me.
 *
 * Platform tokens carry no permissions (they were taken out: a 9 KB header),
 * and the platform's PermissionsGuard resolves them per request and serves the
 * result on /v1/auth/me. Asking that route means review-service sees exactly
 * what gostyle-api's own @RequirePermissions would, including a revocation
 * within seconds. Cached per token for PERMISSION_CACHE_TTL_MS.
 *
 * FAILS CLOSED: if the platform cannot answer, the request is refused (503),
 * never let through.
 */
@Injectable()
export class HttpPermissionResolver implements PermissionResolver {
  private readonly cache = new Map<string, { perms: string[] | null; until: number }>();

  constructor(private readonly config: AppConfig) {}

  async permissionsOf(p: PlatformPrincipal): Promise<string[] | null> {
    const key = createHash('sha256').update(p.token).digest('hex');
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.perms;

    let res: Response;
    try {
      res = await fetch(`${this.config.platform.apiUrl}/v1/auth/me`, {
        headers: { authorization: `Bearer ${p.token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
    } catch (e) {
      throw new DependencyUnavailableError(
        'gostyle-platform',
        `permission lookup failed: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
    let perms: string[] | null;
    if (res.status === 401 || res.status === 403) {
      perms = null;
    } else if (!res.ok) {
      throw new DependencyUnavailableError('gostyle-platform', `permission lookup answered HTTP ${res.status}`);
    } else {
      const body = (await res.json().catch(() => ({}))) as { perms?: unknown };
      perms = Array.isArray(body.perms) ? body.perms.filter((x): x is string => typeof x === 'string') : [];
    }
    this.remember(key, perms);
    return perms;
  }

  private remember(key: string, perms: string[] | null): void {
    if (this.config.permissionCacheTtlMs === 0) return;
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(key, { perms, until: Date.now() + this.config.permissionCacheTtlMs });
  }
}
