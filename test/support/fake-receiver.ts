import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Records every request it gets; answers with `status` (and `body`). */
export class FakeReceiver {
  readonly requests: { method: string; url: string; headers: Record<string, unknown>; body: any }[] = [];
  status = 200;
  body: unknown = {};
  private server: Server | null = null;
  port = 0;

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null });
        res.writeHead(this.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(this.body));
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server!.address() as AddressInfo).port;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}
