import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import {
  type AuthedRequest,
  REQUIRE_PERMISSIONS,
  REQUIRE_PLATFORM_ACTOR,
} from './decorators';
import { PERMISSION_RESOLVER, type PermissionResolver } from './permission-resolver';
import { InvalidTokenError, secretFingerprint, verifyPlatformToken } from './platform-token';

/**
 * Staff and HQ routes: a platform JWT, verified locally, then the route's
 * permission codes resolved through the platform, then (HQ) the actor.
 *
 * NOT global: public and internal routes do not carry a staff token, and each
 * controller states which guard it is behind.
 */
@Injectable()
export class PlatformJwtGuard implements CanActivate, OnModuleInit {
  private static readonly log = new Logger(PlatformJwtGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    @Inject(PERMISSION_RESOLVER) private readonly permissions: PermissionResolver,
  ) {}

  onModuleInit(): void {
    // Said at boot so a mismatch with gostyle-api is a two-second comparison.
    PlatformJwtGuard.log.log(
      `platform tokens verified with JWT_ACCESS_SECRET (fingerprint ${secretFingerprint(this.config.jwtAccessSecret)}); it MUST match gostyle-api's`,
    );
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing bearer token' });

    let principal;
    try {
      principal = verifyPlatformToken(match[1].trim(), this.config.jwtAccessSecret);
    } catch (e) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: e instanceof InvalidTokenError ? e.message : 'Invalid token',
      });
    }
    req.principal = principal;

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_PLATFORM_ACTOR, targets)) {
      if (principal.actor !== 'platform_admin') {
        throw new ForbiddenException({ code: 'PLATFORM_ACCESS_REQUIRED', message: 'HQ access is required.' });
      }
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS, targets) ?? [];
    if (required.length > 0) {
      const held = await this.permissions.permissionsOf(principal);
      if (held === null) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'The platform refused this token' });
      }
      const missing = required.filter((p) => !held.includes(p));
      if (missing.length > 0) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: `Missing: ${missing.join(', ')}` });
      }
    }
    return true;
  }
}
