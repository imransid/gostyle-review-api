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

## D6. The ported rules changed by one import line each (P2)

`review-rules.ts`, `review-reply-rules.ts` and `review-report-rules.ts` import
`FieldError` from the platform's `section-schema.ts`, a 600-line storefront
editor module. Only the 14-line `FieldError` / `FieldErrorCode` block came
across, verbatim, as `domain/services/field-error.ts`; the three imports point
at it. `review-invite-message.ts` imports `InviteLocale` from
`ports/invite-sender.port.ts` instead of `ports/review-invite-sender.port.ts`.
Nothing else in the five rule files changed, and their five specs are
byte-identical to the platform's (74 tests).

## D7. An upheld report never resurrects a REMOVED review (P2)

**Code says:** the platform's `PrismaReviewReportReviewRepository.resolve`
sets the review to HIDDEN unconditionally when a report is upheld.

**Why it differs here:** in the platform nothing can set REMOVED, so the
difference never showed. Here HQ can remove a review, and "REMOVED is final"
is a hard rule. `Review.hideForUpheldReport` moves PUBLISHED to HIDDEN, keeps
HIDDEN hidden (re-stamping who decided and why, as the platform does), and
leaves REMOVED alone. The report still becomes UPHELD.

## D8. Hide, restore and remove require a reason (P2)

The plan adds HQ hide / restore / remove (open question "Should HQ get hide,
restore and remove actions?" answered by the task: yes). The platform has no
such endpoints to copy. They take a note validated by the ported
`validateResolutionNote` (10 to 500 characters), the same rule an uphold or a
dismissal already follows, and it is stamped on the review as
`moderation_note`. Reason: these move a real customer's words off a public
page, which is exactly the case the platform says "always needs words".
**To change:** drop the `validateResolutionNote` call in `Review.moveTo`.

## D9. `review_invite.author_display_name` is not carried over (P2)

The platform's invite has this column, but `CreateReviewInviteHandler` always
writes null and `SubmitReviewHandler` never reads it (the name is read from the
contact at submit time). Dropped. A P6 backfill loses nothing (every value is
null). The invite gains `salon_name`, `storefront_slug` and `locale` display
snapshots instead: the review form and the HQ queue need the salon's name, and
review-service has no storefront table to join.

## D10. A failed invite send is retried with a fresh token (P2, wired in P5)

**Code says:** the platform's listener mints, then sends; when the send throws,
the outbox redelivers, `CreateReviewInvite` finds the invite (created: false)
and the listener returns before sending. So a failed send is never re-sent:
the token is gone and the customer never gets a link. The comment there says
"a failed send is retried by the outbox and finds the invite already there";
the code's retry finds it and stops.

**Task says:** "a failed send retries and finds the invite already there, and a
successful send is never repeated."

**Choice:** make the retry real without ever storing the token. Each invite
tracks `send_status`. A send the channel DEFINITELY refused (connection
refused, 5xx, 429) moves it to RETRYING, and a retry job (payload: invite id
only) mints a NEW token for the SAME invite, swaps the stored hash under a
compare-and-set (`WHERE send_status = 'RETRYING' AND used_at IS NULL`), and
sends again. That is safe because the old link reached nobody. A send that
TIMED OUT may have landed, so it becomes UNKNOWN and is never retried: a
second message would be worse than none. SENT is terminal.

**To change:** `INVITE_SEND_RETRY_ATTEMPTS=0` gives the platform's exact
behaviour (a failed send is recorded as FAILED and never re-sent).

## D11. The summary is recounted under a lock, not patched with a delta (P3)

**Plan says:** a stored summary "updated in the same transaction as each
review change", with a nightly recompute to catch drift.

**Choice:** in that same transaction the projector LOCKS the storefront's
`rating_summary` row (`SELECT … FOR UPDATE`, creating it first if needed),
recounts the storefront's PUBLISHED reviews from the rows, and replaces the
counts. The domain's `visibilityDelta` still runs: a zero delta (a reply, a
report, HIDDEN → REMOVED) skips the write, and a non-zero one is the
expectation the recount is checked against, so drift from anywhere else is
logged the moment it is met.

**Why:** a `n = n + delta` update is fast but trusts that the row was right
before; a recount under the lock cannot drift through this path, and the lock
serialises concurrent writers per storefront (20 concurrent submits on one
storefront end at count 20, version 20: `test/db/rating-summary.spec.ts`). The
recount reads the `(storefront_id, state, created_at)` index the platform
built for exactly this query.

**To change:** replace `replace(...)` in `RatingProjector.onReviewChange` with
an additive update of `delta`; the nightly recompute stays as the repair.

## D12. The relay claims with a lease instead of holding a transaction (P3)

booking-api's `OutboxRelay` delivers inside the `FOR UPDATE SKIP LOCKED`
transaction, holding row locks and a pooled connection across every HTTP call.
Here one statement claims a batch by pushing `next_attempt_at` 60 s ahead
(still `SKIP LOCKED`, so concurrent relays get disjoint batches), delivery
happens outside any transaction, and each row's outcome is its own update.
Retries back off 1 s, 2 s, 4 s … capped at 10 min, for 20 attempts (about two
hours); then the row is "stuck" and counted by `OutboxRelay.stats()`. The
relay runs as a BullMQ job scheduler (`review-outbox`, every
`OUTBOX_RELAY_INTERVAL_MS`), as asked.

## D13. Salon ownership is checked on the review row, not through a branch directory (P3)

The platform walks branch → storefront → review with three tenant-scoped
reads (`loadReviewForSalon`). review-service owns no branch or storefront
table; each review row carries `tenant_id`, `branch_id` and `storefront_id`,
and a storefront is one per branch. So the walk is one query:
`WHERE id = :review AND tenant_id = :jwtTenant AND branch_id = :branch`. Same
answer for every case that matters (another salon, another branch, a guessed
id: 404), with one difference: the platform could answer `BRANCH_NOT_FOUND`
or `STOREFRONT_NOT_FOUND`; here those cases are `REVIEW_NOT_FOUND`.

## D14. Contact lookup owner per booking system (P3, open question §9)

**Question:** after the move, who answers name and phone for a customer?

**Choice:** for `platform` bookings, gostyle-platform answers through a new
internal route (added in P5). For `booking_api` bookings the customer id is a
customer-api account, and there is no agreed owner, so the contact directory
answers "no contact": the invite is still minted (exactly one), its
`send_status` becomes `NO_CONTACT`, nothing is sent, and the reviewer may type
their own name. Nothing fails.

**To change:** give `PlatformDirectoryClient.find` (or a second adapter behind
`CONTACT_DIRECTORY`) a `booking_api` branch once customer-api exposes contact
details to services.

## D15. The projector landed with the write side (P4 item, built in P3)

P4 lists "a rating_summary projector, run in the same transaction as the review
change". Every P3 handler that changes visibility (submit, hide, restore,
remove, uphold) needs it inside its own transaction, so it was built with them
(`application/rating/rating-projector.ts`, see D11). P4 added what reads it:
the public and console aggregates, `GET /internal/ratings`, the nightly
recompute job and `POST /internal/ratings/recompute`.

## D16. Read-side choices (P4)

- **Console list summary and console aggregate come from the stored summary**,
  not a per-request recount as on the platform. Same numbers (proved: the
  seeded e2e compares every served rating with an independent recount from the
  rows), and the console and the public page can never disagree.
- **`GET /v1/public/review-invites/:token` answers 200 with `status`**
  (`OPEN` / `USED` / `EXPIRED`) so the form can say why it is closed; only an
  unknown token is a 404. Submitting still answers 404 / 409 / 410 / 422.
- **The HQ queue's `salonName` and `storefrontSlug` come from the invite's
  display snapshot** (D9), joined through `review.invite_id`. They can lag a
  rename until P6's backfill/refresh; the queue rows also carry
  `storefrontId` and `branchId` so HQ can always resolve the live name.
- **The console aggregate answers the empty aggregate** for a branch with no
  summary row, where the platform could answer `STOREFRONT_NOT_FOUND` (D13).

## D17. Submit throttling is in memory, per replica (P4)

`@nestjs/throttler` with its default in-memory storage: 10 an hour and 40 a
day per client IP on `POST /v1/public/reviews/:token`, nowhere else (the
platform's limits and names). Exact with the single replica `docker-stack.yml`
runs. **To change** (more replicas): give `ThrottlerModule.forRoot` a Redis
storage (review-redis is already there). Client IP comes from
`TRUST_PROXY_HOPS` (default 0, so a direct client cannot pick its own IP by
sending `X-Forwarded-For`); set it to 1 behind nginx.

## D18. Retention is configuration only (P4, open question §9)

**Question:** how long do expired invites, closed reports and removed reviews
stay?

**Choice:** `RETENTION_EXPIRED_INVITE_DAYS` (default 90) and
`RETENTION_CLOSED_REPORT_DAYS` (default 365) are validated and logged at boot.
**Nothing deletes.** No job is scheduled and no delete SQL ships, as asked.
REMOVED reviews are kept indefinitely: deleting one would free its booking for
a second review, which is the fraud hole the unique key closes. **To change:**
the P7 cleanup job reads these two values.

## D19. The event contract between the booking systems and review-service (P5)

`POST /internal/events`, callers `platform` and `booking-api`, each with its
own key. Body: `{ id, type, aggregateId, tenantId?, occurredAt?, payload }`,
exactly these fields (the DTO refuses others). `id` is the source's outbox row
id; `(caller, id)` is the inbox key. Accepted pairs:

| caller        | type                            | booking_source |
| ------------- | ------------------------------- | -------------- |
| `platform`    | `bookings.booking.completed.v1` | `platform`     |
| `booking-api` | `booking.completed`             | `booking_api`  |

Anything else is answered `{ outcome: "ignored" }`. A consumed event is
always 200 with its outcome (`invite_minted`, `duplicate_event`,
`already_invited`, `no_storefront`, `tenant_mismatch`, `malformed`); only a
dependency outage is 503, which the senders retry. Payload fields used:
`branchId`, `customerId`, and `tenantId` (payload or envelope).

## D20. The platform answers a second internal lookup: storefront by branch (P5)

**Asked:** "a minimal internal contact-lookup endpoint (name and phone by
customer id)" in the platform.

**Also needed:** minting an invite needs the storefront, its tenant, the
salon's name and the tenant's language. The platform knows them; booking-api
does not (its events carry a branch id only). So the same key-protected,
default-off controller also serves
`GET /internal/review-service/storefronts/by-branch/:branchId`. Both routes
are read-only and touch no review table.

## D21. booking-api: tenant from the booking row, never defaulted (P5)

booking-api's `booking.tenant_id` is nullable ("captured and not yet
enforced"). The forwarder sends it when present. review-service always takes
the tenant from the platform's storefront for that branch, and refuses an
event that names a DIFFERENT tenant (`tenant_mismatch`). A null tenant is
not a mismatch and not a default: the owner of the branch decides.

## D22. The invite is sent inline, after the commit (P5)

Like the platform listener, the consumer sends right after the invite commits,
inside the event request. A crash between the commit and the send leaves the
invite `PENDING`: the redelivery is a duplicate, so nothing resends it. Same
gap as the platform's; now at least visible
(`SELECT … WHERE send_status = 'PENDING' AND created_at < now() - interval '10 minutes'`).
Not auto-retried: a crash DURING the send could have delivered it.

## D23. customer-api's branch starts from local `main`, not `origin/main` (P5)

In gostyle-customer-api, local `main` tracks `imransid/main` (the line the
plan audited, with "top rated" and the zero-coalesced `review_count`);
`origin/main` is a different lineage without them. The integration branch
starts from local `main` (`24aa3e6`). booking-api and the platform branch from
`origin/main` (their `main` tracks it; the platform's local `main` was 142
commits behind it, and the branch you had checked out is contained in it).

## D24. Every migration ran inside the local review-db container (P5)

customer-api's tests and its local proof needed its new tables. Per the hard
limit ("run migrations only against the local review-db container"), nothing
was migrated in your local `gostyle` database: the Django test runner and the
proof used throwaway databases inside `review-db` (`customer_api_local`,
`test_customer_api_local`, `customer_api_proof`). The proof database got the
platform tables' STRUCTURE (a schema-only `pg_dump` of `gostyle`, no rows)
plus one synthetic salon. Drop them any time:
`docker exec review-service-review-db-1 psql -U review -d postgres -c 'DROP DATABASE customer_api_proof'`.

## D25. EraseCustomerReviews has a handler and no trigger yet (P5)

The command exists and is tested (blank the author name and customer id on a
customer's reviews and invites). No service emits a customer-deleted event
today, so no consumer is wired; inventing an event name another team must
then emit would be a contract nobody agreed. Wire it in `COMPLETION_EVENTS`'s
sibling when the producer exists.

## D26. The Prisma CLI is a dev dependency (P5, found by the final image build)

booking-api keeps `prisma` (the CLI) in `dependencies`. Here the final
rebuild of the runtime image failed in `yarn workspaces focus --production`:
`@prisma/engines` (pulled in by the CLI) runs an install script that downloads
engine binaries, and that download failed. The runtime never needs them:
Prisma 7 with `@prisma/adapter-pg` runs on `@prisma/client` alone, and
migrations run from the separate `migrate` image, which installs dev
dependencies. So `prisma` and `dotenv` (read only by `prisma.config.ts`) moved
to `devDependencies`: a smaller runtime image with no network step at install.

## D27. Swagger in production is its own switch, `SWAGGER_ENABLED` (after P5)

**Asked:** a way to open Swagger in production for testing.

**Not NODE_ENV:** setting `NODE_ENV=development` on the production service
would show the docs, and would also drop the 32-character minimum on the
service keys (`app-config.ts`); Express takes its own `env` setting from it
too. A testing convenience must not quietly weaken boot validation, so the
docs get a flag of their own and `NODE_ENV` stays `production`.

**The rule:** outside production Swagger is always served, as before. In
production it is served at `/docs` and `/docs-json` only when
`SWAGGER_ENABLED` is exactly `true`; anything else, a typo included, leaves it
off. Every route keeps its guards; the docs show route shapes (the
`/internal/*` ones too), not data. Boot logs a warning line while it is on.

**To use:** `SWAGGER_ENABLED=true docker stack deploy ...`, test, then deploy
again without it (the stack defaults it to `false`).

## D28. No public rating route (after P5)

**Plan says:** `GET /v1/public/storefronts/:id/rating` for the app and web.

**Removed:** nothing calls it. The platform never had a public rating route,
and the app reads a salon's rating from customer-api, whose copy
(`ReviewRating`, fed by `rating.summary.changed.v1` and backfilled from
`GET /internal/ratings`) already carries the average, count, per-language
counts and histogram. A second public read of the same numbers would be one
more route to throttle, document and keep in step, for no caller.

**What stays:** the salon console's `GET /v1/storefront/reviews/aggregate`
(the console calls it today), `GET /internal/ratings` (customer-api's backfill
and repair) and `POST /internal/ratings/recompute` (ops, and the P6 runbook).
The e2e specs now read the served rating through the console aggregate; it is
the same stored summary.

**To change:** if a front end ever needs it, the handler was a single
`findUnique` on `rating_summary` by storefront id, answered through
`aggregateOf()` like the console aggregate.
