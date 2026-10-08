import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { FakePlatform } from '../support/fake-platform';
import { FakeReceiver } from '../support/fake-receiver';
import { assertLocal, prepareTestDatabase, TEST_DATABASE_URL } from '../support/local-db';

export const KEYS = {
  platform: 'e2e-key-platform-calls-review-0001',
  bookingApi: 'e2e-key-booking-api-calls-review-01',
  customerApi: 'e2e-key-customer-api-calls-review-1',
  ops: 'e2e-key-ops-calls-review-00000000001',
  platformInternal: 'e2e-key-review-calls-platform-00001',
  reviewCallsCustomer: 'e2e-key-review-calls-customer-api-01',
};
export const JWT_SECRET = 'e2e-jwt-secret-shared-with-gostyle-api';

/** Boot the real AppModule against review_test, review-redis and a fake platform. */
export async function bootApp(extraEnv: Record<string, string> = {}) {
  assertLocal(TEST_DATABASE_URL);
  await prepareTestDatabase();
  const platform = new FakePlatform(JWT_SECRET, KEYS.platformInternal);
  await platform.start();
  // push-notification-service and customer-api, as recorders.
  const push = new FakeReceiver();
  push.status = 202;
  push.body = { devices: 1, queued: 1, duplicates: 0 };
  const customerApi = new FakeReceiver();
  await Promise.all([push.start(), customerApi.start()]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '3399', // never listened on: supertest drives the server directly
    LOG_LEVEL: 'warn',
    DATABASE_URL: TEST_DATABASE_URL,
    TRUST_PROXY_HOPS: '1',
    QUEUE_PREFIX: 'review-e2e',
    JWT_ACCESS_SECRET: JWT_SECRET,
    PLATFORM_API_URL: platform.url,
    PLATFORM_INTERNAL_KEY: KEYS.platformInternal,
    SERVICE_KEY_PLATFORM: KEYS.platform,
    SERVICE_KEY_BOOKING_API: KEYS.bookingApi,
    SERVICE_KEY_CUSTOMER_API: KEYS.customerApi,
    SERVICE_KEY_OPS: KEYS.ops,
    INVITE_SENDER: 'log',
    PERMISSION_CACHE_TTL_MS: '0',
    // Every required variable is set here, so the specs never depend on a
    // local .env (CI has none). Redis: the local review-redis unless CI says.
    REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
    REDIS_PORT: process.env.REDIS_PORT ?? '6382',
    REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'change-me-redis',
    PUSH_API_URL: push.url,
    PUSH_API_KEY: 'e2e-push-key',
    CUSTOMER_API_URL: customerApi.url,
    CUSTOMER_API_KEY: KEYS.reviewCallsCustomer,
    REVIEW_PUBLIC_BASE_URL: 'https://gostyle.test/review',
    OUTBOX_RELAY_INTERVAL_MS: '200',
    ...extraEnv,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    platform,
    push,
    customerApi,
    http: () => request(app.getHttpServer()),
    async close() {
      await app.close();
      await Promise.all([platform.stop(), push.stop(), customerApi.stop()]);
    },
  };
}

export type E2E = Awaited<ReturnType<typeof bootApp>>;

export async function reset(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE review_report, review_reply, review, review_invite, rating_summary, outbox_event, inbox_event',
  );
}
