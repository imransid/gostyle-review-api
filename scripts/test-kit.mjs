#!/usr/bin/env node
// Local test kit for testing review-service by hand (docs/TESTING.md).
//
// One small HTTP server that stands in for the three systems review-service
// calls, so the complete flow runs on one machine:
//
//   gostyle-api                 GET /v1/auth/me
//                               GET /internal/review-service/storefronts/by-branch/:id
//                               GET /internal/review-service/customers/:id/contact
//   customer-api                POST /internal/review-events/
//   push-notification-service   POST /notifications/user
//
// It prints ready-made staff and HQ login tokens (signed with the
// JWT_ACCESS_SECRET from .env), the service keys, the demo salon's ids and a
// "booking completed" event to paste into Swagger. GET /kit prints them again.
//
// Local only: it refuses to start with NODE_ENV=production.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';

if (process.env.NODE_ENV === 'production') {
  console.error('test-kit: refusing to run with NODE_ENV=production');
  process.exit(1);
}

const PORT = Number(process.env.KIT_PORT ?? 3390);
const APP_PORT = Number(process.env.PORT ?? 3352);
const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`test-kit: ${name} is not set (copy .env.example to .env first)`);
    process.exit(1);
  }
  return v;
};
const JWT_SECRET = need('JWT_ACCESS_SECRET');
const PLATFORM_INTERNAL_KEY = need('PLATFORM_INTERNAL_KEY');
const CUSTOMER_API_KEY = need('CUSTOMER_API_KEY');
const PUSH_API_KEY = need('PUSH_API_KEY');

// ─── demo data: fixed ids, so the guide can name them ─────────────────────
const SALON = {
  storefrontId: '30000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  branchId: '20000000-0000-4000-8000-000000000001',
  salonName: 'Kit Test Salon',
  slug: 'kit-test-salon',
  locale: 'en',
};
const OTHER_SALON = {
  storefrontId: '30000000-0000-4000-8000-000000000002',
  tenantId: '10000000-0000-4000-8000-000000000002',
  branchId: '20000000-0000-4000-8000-000000000002',
  salonName: 'Kit Other Salon',
  slug: 'kit-other-salon',
  locale: 'ar',
};
const UNKNOWN_BRANCH = '20000000-0000-4000-8000-000000000099';
const CUSTOMER_ID = '40000000-0000-4000-8000-000000000001';
const CONTACT = { displayName: 'Sara Test', phone: '+971500000001' };

const STAFF_PERMS = ['storefront-edit.read', 'marketing-reviews.update', 'marketing-reviews.create'];
const PEOPLE = {
  staff: {
    sub: '50000000-0000-4000-8000-000000000001',
    claims: { tenantId: SALON.tenantId, branchId: SALON.branchId, actor: 'tenant_user' },
    perms: STAFF_PERMS,
    use: 'salon staff of Kit Test Salon, every console permission',
  },
  staffReadOnly: {
    sub: '50000000-0000-4000-8000-000000000002',
    claims: { tenantId: SALON.tenantId, branchId: SALON.branchId, actor: 'tenant_user' },
    perms: ['storefront-edit.read'],
    use: 'salon staff who can only read (reply must answer 403)',
  },
  otherSalonStaff: {
    sub: '50000000-0000-4000-8000-000000000003',
    claims: { tenantId: OTHER_SALON.tenantId, branchId: OTHER_SALON.branchId, actor: 'tenant_user' },
    perms: STAFF_PERMS,
    use: "staff of another salon (Kit Test Salon's reviews must answer 404)",
  },
  hq: {
    sub: '60000000-0000-4000-8000-000000000001',
    claims: { actor: 'platform_admin' },
    perms: ['storefront.review_moderation'],
    use: 'GoStyle HQ moderator',
  },
};
const permsBySub = new Map(Object.values(PEOPLE).map((p) => [p.sub, p.perms]));
const token = (p) =>
  jwt.sign({ roles: [], sub: p.sub, ...p.claims }, JWT_SECRET, {
    issuer: 'gostyle-api',
    expiresIn: '12h',
    algorithm: 'HS256',
  });

/** A fresh "booking completed" event, as gostyle-platform sends it. */
function newEvent(salon = 'main') {
  const branchId = salon === 'other' ? OTHER_SALON.branchId : salon === 'unknown' ? UNKNOWN_BRANCH : SALON.branchId;
  return {
    id: randomUUID(),
    type: 'bookings.booking.completed.v1',
    aggregateId: randomUUID(),
    payload: { branchId, customerId: CUSTOMER_ID },
  };
}

function kitInfo() {
  return {
    swagger: `http://127.0.0.1:${APP_PORT}/docs`,
    startTheApp: appCommand(),
    serviceKeys: {
      platform: process.env.SERVICE_KEY_PLATFORM,
      customerApi: process.env.SERVICE_KEY_CUSTOMER_API,
      ops: process.env.SERVICE_KEY_OPS,
    },
    tokens: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, { use: p.use, token: token(p) }])),
    salon: SALON,
    otherSalon: OTHER_SALON,
    newEvent: newEvent(),
  };
}

function appCommand() {
  const base = `http://127.0.0.1:${PORT}`;
  return `PLATFORM_API_URL=${base} CUSTOMER_API_URL=${base} PUSH_API_URL=${base} INVITE_SENDER=log_link yarn start:dev`;
}

// ─── the server ───────────────────────────────────────────────────────────
const time = () => new Date().toISOString().slice(11, 19);
const say = (who, text) => console.log(`${time()}  [${who}] ${text}`);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // The kit's own pages.
  if (req.method === 'GET' && path === '/kit') return send(res, 200, kitInfo());
  if (req.method === 'GET' && path === '/kit/event') return send(res, 200, newEvent(url.searchParams.get('salon') ?? 'main'));

  // gostyle-api: who is calling, and what may they do.
  if (req.method === 'GET' && path === '/v1/auth/me') {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    try {
      const claims = jwt.verify(bearer, JWT_SECRET, { issuer: 'gostyle-api' });
      const perms = permsBySub.get(claims.sub);
      if (!perms) return send(res, 401);
      say('gostyle-api', `permissions asked for ${claims.sub}`);
      return send(res, 200, { perms, roles: [] });
    } catch {
      return send(res, 401);
    }
  }

  // gostyle-api: the internal lookups, with review-service's own key.
  if (path.startsWith('/internal/review-service/')) {
    if (req.headers['x-service-key'] !== PLATFORM_INTERNAL_KEY) {
      say('gostyle-api', 'refused a lookup: wrong PLATFORM_INTERNAL_KEY');
      return send(res, 401);
    }
    const sf = /^\/internal\/review-service\/storefronts\/by-branch\/([^/]+)$/.exec(path);
    if (sf) {
      const s = [SALON, OTHER_SALON].find((x) => x.branchId === sf[1]);
      say('gostyle-api', `storefront for branch ${sf[1]}: ${s ? s.salonName : 'none'}`);
      return s ? send(res, 200, s) : send(res, 404);
    }
    const c = /^\/internal\/review-service\/customers\/([^/]+)\/contact$/.exec(path);
    if (c) {
      say('gostyle-api', `contact for customer ${c[1]}: ${CONTACT.displayName}`);
      return send(res, 200, CONTACT);
    }
  }

  // customer-api: the rating copy.
  if (req.method === 'POST' && path === '/internal/review-events/') {
    if (req.headers['x-service-key'] !== CUSTOMER_API_KEY) {
      say('customer-api', 'refused an event: wrong CUSTOMER_API_KEY');
      return send(res, 401);
    }
    const e = await readBody(req);
    const p = e.payload ?? {};
    say(
      'customer-api',
      `${e.type}: storefront ${p.storefrontId} now ${p.reviewCount} review(s), average ${p.average ?? 'none'}, version ${p.version}`,
    );
    return send(res, 200, { ok: true });
  }

  // push-notification-service.
  if (req.method === 'POST' && path === '/notifications/user') {
    if (req.headers['x-api-key'] !== PUSH_API_KEY) {
      say('push', 'refused a push: wrong PUSH_API_KEY');
      return send(res, 401);
    }
    const m = await readBody(req);
    say('push', `to user ${m.userId}: "${m.title}" (${m.eventId})`);
    return send(res, 202, { devices: 1, queued: 1, duplicates: 0 });
  }

  return send(res, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  const info = kitInfo();
  const line = '─'.repeat(72);
  console.log(`${line}
review-service test kit on http://127.0.0.1:${PORT}
It stands in for gostyle-api, customer-api and the push service.
${line}

1. Start review-service in another terminal with:

   ${info.startTheApp}

2. Open Swagger: ${info.swagger}

3. Authorize (the lock button):
   service-key   platform     ${info.serviceKeys.platform}
                 customer-api ${info.serviceKeys.customerApi}
                 ops          ${info.serviceKeys.ops}
   platform-jwt  tokens below (paste without "Bearer")

${Object.entries(info.tokens)
  .map(([k, t]) => `   ${k}: ${t.use}\n   ${t.token}\n`)
  .join('\n')}
Demo salon "${SALON.salonName}": storefront ${SALON.storefrontId}
                                branch     ${SALON.branchId}

A "booking completed" event for POST /internal/events (a fresh one each time:
http://127.0.0.1:${PORT}/kit/event):

${JSON.stringify(info.newEvent, null, 2)}

Everything above again: http://127.0.0.1:${PORT}/kit
${line}
What review-service sends to the stand-ins appears below.
`);
});
