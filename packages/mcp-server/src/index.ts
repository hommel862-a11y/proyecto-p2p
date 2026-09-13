/**
 * P2P Decisor — MCP Server Entry Point
 * Conecta createP2PMcpServer() con transporte stdio (por defecto) + SSE opcional.
 */

import { createP2PMcpServer } from './server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const SSE_PORT = Number(process.env.MCP_SSE_PORT ?? 51858);
const ENABLE_SSE = process.env.MCP_ENABLE_SSE === 'true';

async function main() {
  const server = createP2PMcpServer();

  // ─── Transporte stdio (siempre activo, es el canal principal) ───
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error('[MCP] p2p-decisor connected via stdio');

  // ─── Transporte SSE opcional (para Inspector / clientes HTTP) ───
  if (ENABLE_SSE) {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      if (req.url === '/sse' && req.method === 'GET') {
        const transport = new SSEServerTransport('/messages', res);
        await server.connect(transport);
        console.error('[MCP] SSE client connected');
        return;
      }

      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: 'p2p-decisor', version: '1.0.0' }));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(SSE_PORT, '127.0.0.1', () => {
      console.error(`[MCP] SSE server listening on http://127.0.0.1:${SSE_PORT}`);
    });

    const shutdown = async () => {
      console.error('[MCP] Shutting down...');
      await server.close();
      httpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// Allow running directly: tsx src/index.ts
main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});