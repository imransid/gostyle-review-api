# review-service

Ratings and reviews for GoStyle salons, extracted from gostyle-platform's
`nest-storefront` package. The plan is [`docs/PLAN.html`](docs/PLAN.html);
where the code and the plan disagreed, [`docs/DECISIONS.md`](docs/DECISIONS.md)
says what was done and why.

NestJS 12 · CQRS · Prisma 7 on its own Postgres · BullMQ on its own Redis.

## Commands

```bash
yarn install
cp .env.example .env          # local values only; never commit .env
docker compose up -d review-db review-redis
yarn prisma generate
yarn prisma migrate deploy    # its own step; the app never migrates at boot
yarn start:dev                # http://127.0.0.1:3352, Swagger at /docs

yarn typecheck                # tsc --noEmit
yarn lint                     # oxlint
yarn test                     # unit: domain + handlers, no database
yarn test:db                  # repositories and constraints on the local review-db
yarn test:e2e                 # the booted app over HTTP
yarn proof                    # scripts/proof.sql: inserts that MUST fail
yarn prisma:check             # schema.prisma and migrations agree (needs SHADOW_DATABASE_URL)
```

The whole stack in containers:

```bash
docker compose up -d          # review-db, review-redis, review-migrate (exits), review-app
curl http://127.0.0.1:3352/health
```

| Service        | Host port | Notes                                            |
| -------------- | --------- | ------------------------------------------------ |
| `review-app`   | 3352      | also on `gostyle-net` as `review-app`            |
| `review-db`    | 5435      | Postgres 16, private network only                |
| `review-redis` | 6382      | password from `REVIEW_REDIS_PASSWORD`, private   |

3351 is push-notification-service and 3099 is booking-api's dev port.

## Layout

```
src/
  main.ts, app.module.ts
  shared/       config (the only process.env reader), prisma, redis, logging,
                http (error filter, health, validation), auth, outbox
  review/
    domain/          aggregates, value objects, ported rules, ports. Imports
                     nothing from Nest but @nestjs/cqrs, nothing from Prisma.
    application/     commands, queries, consumers, jobs, event handlers
    infrastructure/  Prisma repositories and HTTP adapters behind the ports
    presentation/    controllers: public, console, moderation, internal
prisma/         schema.prisma + migrations (CHECKs and partial indexes hand-written)
scripts/        proof.sql
test/           unit/, db/, e2e/
```

## Configuration

`.env.example` lists every variable. Missing required values stop the boot with
every problem named at once. Secrets accept `<NAME>_FILE`.
