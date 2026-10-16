import { createServer, type Server } from 'node:http';

export type HealthCheck = () => Promise<Record<string, boolean>>;

/** GET /health → 200 se tudo ok, 503 caso contrário (usado pelo Docker e orquestradores). */
export function startHealthServer(port: number, check: HealthCheck): Server {
  const server = createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const status = await check().catch(() => ({ check: false }));
    const ok = Object.values(status).every(Boolean);
    res
      .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok, ...status }));
  });
  server.listen(port);
  return server;
}
