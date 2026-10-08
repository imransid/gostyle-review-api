import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppConfig, SERVICE_CALLERS as CALLERS, type ServiceCaller } from '../config/app-config';
import { type AuthedRequest, SERVICE_CALLERS } from './decorators';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Internal routes: `x-service-key`, ONE KEY PER CALLING SERVICE.
 *
 * The push service compared one shared key with `!==`, which leaks timing and
 * cannot say who called. Here every configured key is compared with
 * timingSafeEqual over SHA-256 digests (equal lengths, so the comparison
 * itself never throws or short-circuits on length), every key is checked
 * whatever matched first, and the match NAMES the caller. A route then states
 * which callers it accepts.
 */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  private readonly keys: { caller: ServiceCaller; digest: Buffer }[];

  constructor(
    private readonly reflector: Reflector,
    config: AppConfig,
  ) {
    this.keys = CALLERS.map((caller) => ({ caller, digest: digest(config.serviceKeys[caller]) }));
  }

  /** Which caller a presented key belongs to, or null. Constant time over all keys. */
  identify(presented: string): ServiceCaller | null {
    const d = digest(presented);
    let found: ServiceCaller | null = null;
    for (const k of this.keys) {
      if (timingSafeEqual(d, k.digest) && found === null) found = k.caller;
    }
    return found;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const presented = req.headers['x-service-key'];
    const caller = typeof presented === 'string' && presented !== '' ? this.identify(presented) : null;
    if (caller === null) {
      throw new UnauthorizedException({ code: 'SERVICE_KEY_INVALID', message: 'Missing or unknown service key' });
    }
    const allowed =
      this.reflector.getAllAndOverride<ServiceCaller[]>(SERVICE_CALLERS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (!allowed.includes(caller)) {
      throw new ForbiddenException({ code: 'SERVICE_CALLER_FORBIDDEN', message: `${caller} may not call this route` });
    }
    req.serviceCaller = caller;
    return true;
  }
}
