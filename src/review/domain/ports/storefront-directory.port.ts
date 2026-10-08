export const STOREFRONT_DIRECTORY = Symbol('STOREFRONT_DIRECTORY');

/** The storefront facts an invite needs. Owned by gostyle-platform. */
export interface StorefrontInfo {
  storefrontId: string;
  tenantId: string;
  branchId: string;
  salonName: string;
  slug: string | null;
  /** The tenant's default locale ("en", "ar-AE"); picks the invite language. */
  locale: string | null;
}

/**
 * Which storefront a branch has. A storefront is one per branch; a branch
 * with none has no page to review, and that is ordinary, not an error (null).
 * Throws DependencyUnavailableError when the platform cannot be reached.
 */
export interface StorefrontDirectory {
  findByBranch(branchId: string): Promise<StorefrontInfo | null>;
}
