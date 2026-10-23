import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';
import type { GatewayConfig, InboundReceiptEvent, InboundNormalizedMessage } from './types.js';
import { verifyMetaSignature, verifyBearerToken } from './crypto-verify.js';
import { DedupCache } from './dedup-cache.js';
import { parseMetaWebhookPayload } from './meta-webhook-parser.js';
import { processInboundMessageToReceipt } from './receipt-intake.js';
import type { PipelineDeal } from '@p2p/core';

export class InboundGatewayServer {
  private readonly server: Server;
  private readonly config: GatewayConfig;
  private readonly dedupCache: DedupCache;
  private readonly pendingEvents: InboundReceiptEvent[] = [];
  private readonly sseClients: Set<ServerResponse> = new Set();
  private knownDeals: PipelineDeal[] = [];

  constructor(config: GatewayConfig) {
    this.config = config;
    this.dedupCache = new DedupCache(config.idempotencyTtlSeconds);
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  setKnownDeals(deals: PipelineDeal[]): void {
    this.knownDeals = deals;
  }

  getPendingEvents(): InboundReceiptEvent[] {
    return [...this.pendingEvents];
  }

  clearPendingEvents(): void {
    this.pendingEvents.length = 0;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, '0.0.0.0', () => {
        const addr = this.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
        resolve(port);
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    this.dedupCache.destroy();
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route: GET /health
    if (method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'UP',
        timestamp: Date.now(),
        cachedEvents: this.dedupCache.size(),
        pendingReceipts: this.pendingEvents.length,
      }));
      return;
    }

    // Route: GET /webhook/meta (Verification Challenge)
    if (method === 'GET' && pathname === '/webhook/meta') {
      const mode = parsedUrl.searchParams.get('hub.mode');
      const token = parsedUrl.searchParams.get('hub.verify_token');
      const challenge = parsedUrl.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === (this.config.metaVerifyToken || 'p2p-verify-secret')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge ?? '');
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'VERIFICATION_TOKEN_MISMATCH' }));
      }
      return;
    }

    // Route: POST /webhook/meta (WhatsApp & Instagram Incoming Events)
    if (method === 'POST' && pathname === '/webhook/meta') {
      const rawBody = await this.readRawBody(req);

      // Verify HMAC-SHA256 signature if secret is configured
      if (this.config.metaAppSecret) {
        const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
        const isValid = verifyMetaSignature(rawBody, sigHeader, this.config.metaAppSecret);
        if (!isValid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'INVALID_SIGNATURE' }));
          return;
        }
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const messages = parseMetaWebhookPayload(payload);
      let newReceiptsCount = 0;

      for (const msg of messages) {
        // Idempotency check: if eventId was already seen, skip duplicate processing
        if (this.dedupCache.checkAndRecord(msg.eventId)) {
          continue;
        }

        const receipt = processInboundMessageToReceipt(msg, this.config.targetScope, this.knownDeals);
        if (receipt) {
          this.pendingEvents.push(receipt);
          this.broadcastSseEvent('new_receipt', receipt);
          newReceiptsCount++;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        processedMessages: messages.length,
        newReceiptsDetected: newReceiptsCount,
      }));
      return;
    }

    // Route: POST /api/inbound/receipt (Generic Intake for Gmail / Custom webhook)
    if (method === 'POST' && pathname === '/api/inbound/receipt') {
      // Check Bearer Token if configured
      if (this.config.apiSecretToken) {
        const authHeader = req.headers.authorization;
        if (!verifyBearerToken(authHeader, this.config.apiSecretToken)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
          return;
        }
      }

      const rawBody = await this.readRawBody(req);
      let body: { text?: string; sender?: string; channel?: string; eventId?: string };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      if (!body.text || typeof body.text !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MISSING_TEXT' }));
        return;
      }

      const eventId = body.eventId || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (this.dedupCache.checkAndRecord(eventId)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, duplicate: true }));
        return;
      }

      const normalizedMsg: InboundNormalizedMessage = {
        eventId,
        channel: (body.channel as any) || 'GMAIL',
        sender: {
          id: body.sender || 'UNKNOWN',
          channel: (body.channel as any) || 'GMAIL',
        },
        text: body.text,
        timestamp: Date.now(),
      };

      const receipt = processInboundMessageToReceipt(normalizedMsg, this.config.targetScope, this.knownDeals);
      if (receipt) {
        this.pendingEvents.push(receipt);
        this.broadcastSseEvent('new_receipt', receipt);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        receiptDetected: Boolean(receipt),
        receipt,
      }));
      return;
    }

    // Route: GET /api/events/pending (Desktop app pulls pending receipts)
    if (method === 'GET' && pathname === '/api/events/pending') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: this.pendingEvents.length,
        events: this.pendingEvents,
      }));
      return;
    }

    // Route: GET /api/events (Server-Sent Events stream for instant CRM refresh)
    if (method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  }

  private broadcastSseEvent(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private readRawBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
