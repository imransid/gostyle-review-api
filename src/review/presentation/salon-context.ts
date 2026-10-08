import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { PlatformPrincipal } from '../../shared/auth/platform-token';

/**
 * The salon a console call acts for.
 *
 * TENANT FROM THE JWT ONLY. The platform's @TenantId() falls back to a
 * DEFAULT_TENANT_ID when the claim is absent, and its own code warns that this
 * is a fail-open hole. Here an absent tenant is a 403, never a default.
 *
 * BRANCH: an explicit branchId wins over the claim (a multi-branch manager
 * switches branches), as the platform's resolveBranchId; every read and write
 * then also filters on the JWT's tenant, so an explicit id is not a way into
 * another salon.
 */
export function salonContext(p: PlatformPrincipal, explicitBranchId: string | undefined) {
  if (!p.tenantId) {
    throw new ForbiddenException({ code: 'TENANT_REQUIRED', message: 'This route needs a salon (tenant) token.' });
  }
  const branchId = explicitBranchId ?? p.branchId;
  if (!branchId) throw new UnprocessableEntityException({ code: 'BRANCH_REQUIRED', message: 'branchId is required.' });
  return { tenantId: p.tenantId, branchId, actorId: p.userId };
}
