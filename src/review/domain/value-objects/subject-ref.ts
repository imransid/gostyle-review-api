import { DomainError } from '../domain.error';
import { isUuid } from '../shared/uuidv7';

/**
 * What a review is about: one salon's storefront, inside one tenant.
 *
 * A storefront is one per branch, so (tenant, branch) identifies it from the
 * console side and storefront identifies it from the public side. All three
 * travel together so neither side has to look the other up.
 */
export class SubjectRef {
  private constructor(
    readonly tenantId: string,
    readonly storefrontId: string,
    readonly branchId: string,
  ) {}

  static of(p: { tenantId: unknown; storefrontId: unknown; branchId: unknown }): SubjectRef {
    const bad = (['tenantId', 'storefrontId', 'branchId'] as const).filter((k) => !isUuid(p[k]));
    if (bad.length > 0) {
      throw DomainError.validation(
        bad.map((field) => ({ field, code: 'INVALID_FORMAT', message: `${field} must be a uuid.` })),
      );
    }
    return new SubjectRef(
      (p.tenantId as string).toLowerCase(),
      (p.storefrontId as string).toLowerCase(),
      (p.branchId as string).toLowerCase(),
    );
  }

  /** Whether a console caller working in (tenant, branch) owns this subject. */
  ownedBy(salon: { tenantId: string; branchId: string }): boolean {
    return (
      this.tenantId === salon.tenantId.toLowerCase() &&
      this.branchId === salon.branchId.toLowerCase()
    );
  }
}
