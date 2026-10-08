import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import type { StorefrontInfo } from '../../src/review/domain/ports/storefront-directory.port';

/**
 * A stand-in for gostyle-api, answering the three routes review-service calls:
 *
 *   GET /v1/auth/me                                            (caller's token)
 *   GET /internal/review-service/storefronts/by-branch/:id     (x-service-key)
 *   GET /internal/review-service/customers/:id/contact         (x-service-key)
 *
 * Real HTTP, so the real adapters are exercised end to end.
 */
export class FakePlatform {
  readonly storefronts = new Map<string, StorefrontInfo>();
  readonly contacts = new Map<string, { displayName: string | null; phone: string | null }>();
  readonly perms = new Map<string, string[]>();
  meCalls = 0;
  down = false;
  private server: Server | null = null;
  port = 0;

  constructor(
    private readonly jwtSecret: string,
    private readonly internalKey: string,
  ) {}

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server!.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private send(res: ServerResponse, status: number, body?: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    if (this.down) return this.send(res, 503, { error: 'down' });
    const url = req.url ?? '';
    if (url === '/v1/auth/me') {
      this.meCalls += 1;
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      try {
        const claims = jwt.verify(token, this.jwtSecret, { issuer: 'gostyle-api' }) as { sub: string };
        const perms = this.perms.get(claims.sub);
        return perms ? this.send(res, 200, { perms, roles: [] }) : this.send(res, 401);
      } catch {
        return this.send(res, 401);
      }
    }
    if (url.startsWith('/internal/review-service/')) {
      if (req.headers['x-service-key'] !== this.internalKey) return this.send(res, 401);
      const sf = /^\/internal\/review-service\/storefronts\/by-branch\/([^/]+)$/.exec(url);
      if (sf) {
        const s = this.storefronts.get(sf[1]);
        return s ? this.send(res, 200, s) : this.send(res, 404);
      }
      const c = /^\/internal\/review-service\/customers\/([^/]+)\/contact$/.exec(url);
      if (c) {
        const contact = this.contacts.get(c[1]);
        return contact ? this.send(res, 200, contact) : this.send(res, 404);
      }
    }
    return this.send(res, 404);
  }
}
