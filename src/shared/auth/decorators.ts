import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ServiceCaller } from '../config/app-config';
import type { PlatformPrincipal } from './platform-token';

export const REQUIRE_PERMISSIONS = 'review:require-permissions';
export const REQUIRE_PLATFORM_ACTOR = 'review:require-platform-actor';
export const SERVICE_CALLERS = 'review:service-callers';

/** Every listed code is required (AND), as the platform's decorator. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(REQUIRE_PERMISSIONS, codes);

/** HQ only: the JWT's actor must be platform_admin (the platform's assertPlatformActor). */
export const RequirePlatformActor = () => SetMetadata(REQUIRE_PLATFORM_ACTOR, true);

/** Which services may call an internal route. */
export const ServiceCallers = (...callers: ServiceCaller[]) => SetMetadata(SERVICE_CALLERS, callers);

export interface AuthedRequest {
  principal?: PlatformPrincipal;
  serviceCaller?: ServiceCaller;
}

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformPrincipal =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal!,
);

export const CurrentServiceCaller = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ServiceCaller =>
    ctx.switchToHttp().getRequest<AuthedRequest>().serviceCaller!,
);
