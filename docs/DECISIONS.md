# Decisions log

Where the code and `PLAN.html` disagreed, the code won and the difference is
recorded here. Where an open question from plan §9 was hit, the safest
reversible option was taken and recorded here: the question, the choice, why,
and how to change it.

Numbered in the order they were made. Each entry says which phase made it.

---

## D1. The platform JWT carries no permissions (P1)

**Plan says:** HQ routes check `storefront.review_moderation` from the platform
JWT, "the way booking-api's token-verifier does".

**Code says:** gostyle-platform stopped signing permissions into access tokens
(`nest-auth/.../token.port.ts`: "DO NOT MINT THIS"; a salon owner's ~294 codes
made a 9 KB header nginx rejected). Permissions are resolved per request by the
platform's `PermissionsGuard`. booking-api's verifier only reads `sub`, `roles`,
`branchId`, `tenantId`, which is why it never needed them.

**Choice:** review-service verifies the JWT locally (HS256, issuer
`gostyle-api`, the same secret), then resolves the caller's permissions by
calling the platform's own `GET /v1/auth/me` **with the caller's token**. That
route returns the guard-resolved `perms`, so review-service sees exactly what
the platform's own `@RequirePermissions` would. Results are cached per token
for `PERMISSION_CACHE_TTL_MS` (default 30 s). If the platform cannot be reached
the request is refused with 503 `DEPENDENCY_UNAVAILABLE`, never allowed.

**Why:** fail closed, no new platform endpoint, no second permission model to
drift. A token-carried claim would be faster but does not exist.

**To change:** replace `HttpPermissionResolver` (one provider line in
`review.module.ts`) with any other `PermissionResolver`, e.g. one reading a
`perms` claim if the platform ever signs a short one again.

## D2. The database and Redis are not on gostyle-net (P1)

**Asked:** "Compose services review-app, review-db and review-redis … on
gostyle-net."

**Choice:** all three names are prefixed as asked, but only `review-app` joins
`gostyle-net`. `review-db` and `review-redis` sit on the stack's private
network, exactly as push-notification-service keeps `push-db` and `push-redis`
off the shared network.

**Why:** plan §1 "One owner, one database … no other service reads its
tables". On a private network that is enforced, not just agreed.

**To change:** add `gostyle:` under `networks:` for `review-db` /
`review-redis` in `docker-compose.yml` (and `gostyle-net` in
`docker-stack.yml`).

## D3. The shared network has a different name locally (P1)

push's compose joins `gostyle_gostyle-net` (the Swarm-made name on the server);
this machine has a hand-made `gostyle-net` (booking-api's compose and the
running platform and booking-api containers use it). The compose file takes
`GOSTYLE_NETWORK`, defaulting to `gostyle-net`. Set
`GOSTYLE_NETWORK=gostyle_gostyle-net` on the server. The Swarm stack file uses
`gostyle_gostyle-net` directly.

## D4. booking-api does not actually use pino (P1)

**Plan / task say:** take pino logging from booking-api.

**Code says:** booking-api lists `nestjs-pino`, `pino` and `pino-http` in
`package.json` but nothing in `src/` imports them; it logs through Nest's plain
`Logger`.

**Choice:** wired `nestjs-pino` here from scratch: JSON lines, a request id
(reusing a sane incoming `x-request-id`, echoed on the response), redacted
`authorization` / `cookie` / `x-service-key` headers, and **the invite token
stripped from logged URLs** (`/v1/public/reviews/:token` and
`/v1/public/review-invites/:token` carry it in the path).

## D5. Every migration statement is retry-safe (P1)

booking-api's conventions §3 asks for `IF NOT EXISTS` on hand-written SQL. The
platform's review migrations go further and guard every statement. Followed the
platform: generated `CREATE TABLE` / `CREATE INDEX` were also made
`IF NOT EXISTS`, enums and constraints are wrapped in
`DO $$ … duplicate_object …`. A migration interrupted half way can be re-run.
