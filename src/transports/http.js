// Streamable HTTP transport.
//
// Runs stateless: a fresh transport and server per request. Stateful sessions would
// buy resumability we do not need for read-only lookups, and would cost us
// per-session memory on a box that also runs other services.

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../server.js';

const MAX_BODY = '4mb';

function tokensMatch(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first — but still
  // run the comparison on equal-length buffers so we do not leak length by timing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireAuth(token) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || !tokensMatch(match[1].trim(), token)) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
      return;
    }
    next();
  };
}

export async function startHttp(config, options) {
  const { port, host, token, allowNoAuth } = options;

  if (!token && !allowNoAuth) {
    throw new Error(
      'Refusing to start HTTP without a token. This server can expose documents marked ' +
      '`public: no`. Set MOTHER_CLAUDE_TOKEN, or pass --no-auth if you are deliberately ' +
      'binding to loopback with a public-only config.'
    );
  }
  if (!token && host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `Refusing to start unauthenticated on ${host}. --no-auth is only permitted on loopback.`
    );
  }

  const app = express();
  app.use(express.json({ limit: MAX_BODY }));
  app.disable('x-powered-by');

  // Unauthenticated: reports liveness only, never corpus contents.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, corpus: config.name });
  });

  const guard = token ? requireAuth(token) : (_req, _res, next) => next();

  app.post('/mcp', guard, async (req, res) => {
    // Per-request instances: the SDK rejects reusing a transport across requests,
    // and this keeps one client's stream from ever touching another's.
    const { server } = createServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
      process.stderr.write(`[mother-claude-mcp] request failed: ${err.stack || err}\n`);
    }
  });

  // Stateless mode has no server-initiated streams and no session to delete.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: server is stateless' },
      id: null,
    });
  app.get('/mcp', guard, methodNotAllowed);
  app.delete('/mcp', guard, methodNotAllowed);

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      process.stderr.write(
        `[mother-claude-mcp] "${config.name}" on http://${host}:${port}/mcp ` +
        `(auth: ${token ? 'bearer token' : 'DISABLED — loopback only'})\n`
      );
      resolve(httpServer);
    });
    httpServer.on('error', reject);
  });
}
