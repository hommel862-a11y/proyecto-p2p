import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { findMonorepoRoot } from './env-loader.js';
import {
  GATEWAY_STORAGE_MODES,
  type GatewayConfig,
  type InboundReceiptEvent,
  type InboundNormalizedMessage,
  type ArmOutboxSseEvent,
  type ArmOutboxEventType,
  type StorageHealthResponse,
  type ReceiptVerifyRequest,
  type ReceiptVerifyResponse,
  type F360SnapshotPayload,
  type F360StoredSnapshot,
  type F360SnapshotGetResponse,
  type F360SnapshotPutResponse,
} from './types.js';
import { verifyMetaSignature, verifyBearerToken } from './crypto-verify.js';
import { DedupCache } from './dedup-cache.js';
import { parseMetaWebhookPayload } from './meta-webhook-parser.js';
import { processInboundMessageToReceipt } from './receipt-intake.js';
import {
  dispatchMetaWhatsappMessage,
  fetchAndAnalyzeMetaMediaWithGemini,
} from './meta-outbound-client.js';
import { PgArmStore, isArmWorkspaceId, type OutboxListenerHandle } from './pg-store.js';
import { WhatsAppQrBridge, type WhatsAppQrMessageEvent } from './whatsapp-qr-bridge.js';
import {
  normalizeBankReference,
  runArmSandboxSimulationTurn,
  scanOutboundMessageDlp,
  evaluateMeta24hFreeWindow,
  evaluateDealTokenCircuitBreaker,
  runArmDeterministicReplayComparison,
  generateCloserPreCallBriefing,
  processCloserPostCallNote,
  evaluateGhostingFollowUp,
  executeArmToolCall,
  type PipelineDeal,
  type ArmWorkspaceId,
  type ArmSandboxPersonaId,
  type ArmApprovalStatus,
  type ArmShadowExample,
  type ArmAgentRole,
  type ArmBantData,
  type ArmLeadProfile,
} from '@p2p/core';

export interface CoalescedTurnBatch {
  conversationKey: string;
  messageCount: number;
  combinedText: string;
  flushedAt: number;
}

export class InboundGatewayServer {
  private readonly server: Server;
  private readonly config: GatewayConfig;
  private readonly dedupCache: DedupCache;
  private readonly pgStore: PgArmStore | null;
  private outboxListener: OutboxListenerHandle | null = null;
  private readonly seenPgOutboxIds: Set<number> = new Set();
  private readonly memoryVerifiedReceipts: Map<string, { receiptId: string; dealId: string | null }> =
    new Map();
  private memoryF360Snapshot: F360StoredSnapshot | null = null;
  private readonly pendingEvents: InboundReceiptEvent[] = [];
  private readonly outboxEvents: ArmOutboxSseEvent[] = [];
  private outboxSeq = 0;
  private readonly coalesceBuffers: Map<string, string[]> = new Map();
  private readonly sseClients: Set<ServerResponse> = new Set();
  private knownDeals: PipelineDeal[] = [];
  private readonly waQrBridge: WhatsAppQrBridge;

  constructor(config: GatewayConfig, pgStore?: PgArmStore) {
    this.config = config;
    this.dedupCache = new DedupCache(config.idempotencyTtlSeconds);
    this.pgStore =
      pgStore ??
      (config.databaseUrl?.trim() ? new PgArmStore(config.databaseUrl.trim()) : null);
    const repoRoot = findMonorepoRoot(process.cwd()) ?? process.cwd();
    const waAuthDir = process.env['WA_QR_AUTH_DIR']?.trim() || join(repoRoot, '.wa-qr-auth');
    this.waQrBridge = new WhatsAppQrBridge({
      authDir: waAuthDir,
      onInboundMessage: async (msg) => {
        await this.handleWhatsAppQrInbound(msg);
      },
      onStateChange: (state) => {
        this.broadcastSseEvent('wa_qr_status', state);
      },
    });
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          this.sendJson(res, 500, {
            error: 'INTERNAL_SERVER_ERROR',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    });
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

  ingestBurstMessageForCoalescing(conversationKey: string, messageText: string): void {
    const trimmed = (messageText || '').trim();
    if (!trimmed) return;
    const list = this.coalesceBuffers.get(conversationKey) ?? [];
    list.push(trimmed);
    this.coalesceBuffers.set(conversationKey, list);
  }

  flushCoalescedConversation(conversationKey: string): CoalescedTurnBatch | null {
    const list = this.coalesceBuffers.get(conversationKey);
    if (!list || list.length === 0) return null;
    this.coalesceBuffers.delete(conversationKey);
    return {
      conversationKey,
      messageCount: list.length,
      combinedText: list.join('\n'),
      flushedAt: Date.now(),
    };
  }

  appendArmOutboxEvent(
    workspaceId: ArmWorkspaceId,
    eventType: ArmOutboxEventType,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): ArmOutboxSseEvent {
    const evt: ArmOutboxSseEvent = {
      id: ++this.outboxSeq,
      workspaceId,
      eventType,
      aggregateId,
      payload,
      timestamp: Date.now(),
    };
    this.outboxEvents.push(evt);
    this.broadcastSseEvent('arm_event', evt, evt.id);
    return evt;
  }

  getOutboxEventsSince(sinceId = 0, workspaceId?: ArmWorkspaceId): ArmOutboxSseEvent[] {
    return this.outboxEvents.filter(
      (e) => e.id > sinceId && (!workspaceId || e.workspaceId === workspaceId),
    );
  }

  runAntiGhostingSweep(
    candidates: ReadonlyArray<{
      workspaceId: ArmWorkspaceId;
      leadId: string;
      leadName: string;
      lastInboundTimestampMs: number;
      followupAttempts: number;
      painPointMemory: string;
    }>,
    nowTimestampMs = Date.now(),
  ): ArmOutboxSseEvent[] {
    const queued: ArmOutboxSseEvent[] = [];
    for (const c of candidates) {
      const res = evaluateGhostingFollowUp({
        workspaceId: c.workspaceId,
        leadId: c.leadId,
        leadName: c.leadName,
        lastInboundTimestampMs: c.lastInboundTimestampMs,
        nowTimestampMs,
        followupAttempts: c.followupAttempts,
        painPointMemory: c.painPointMemory,
      });
      if (res.shouldQueueFollowUp && res.approvalEntry) {
        queued.push(
          this.appendArmOutboxEvent(c.workspaceId, 'approval_requested', res.approvalEntry.id, {
            approval: res.approvalEntry,
            requiresHsmTemplate: res.requiresHsmTemplate,
          }),
        );
      }
    }
    return queued;
  }

  async start(): Promise<number> {
    if (this.pgStore) {
      try {
        this.outboxListener = await this.pgStore.startOutboxListener(
          (evt) => {
            this.handlePgOutboxNotification(evt);
          },
          {
            retryOnInitialFailure: true,
            onStateChange: (state, err) => {
              if (state === 'reconnecting' && err) {
                console.warn(
                  '[P2P-INBOUND-GATEWAY] Outbox listener reconnecting:',
                  err.message,
                );
              }
            },
          },
        );
      } catch (err: unknown) {
        console.warn(
          '[P2P-INBOUND-GATEWAY] Outbox listener deferred:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, '0.0.0.0', () => {
        const addr = this.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
        if (
          process.env['NODE_ENV'] !== 'test' &&
          !process.env['VITEST'] &&
          this.waQrBridge.hasSavedSession()
        ) {
          void this.waQrBridge.connect();
        }
        resolve(port);
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    this.dedupCache.destroy();
    await this.waQrBridge.stop();
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();

    if (this.outboxListener) {
      await this.outboxListener.stop();
      this.outboxListener = null;
    }
    if (this.pgStore) {
      await this.pgStore.close();
    }

    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS headers (restricted when INBOUND_GATEWAY_ALLOWED_ORIGIN or config.allowedOrigin is set)
    this.applyCorsHeaders(req, res);

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

    // Fail-closed Bearer authentication guard for /api/arm/*, /api/f360/*, and /api/events*
    if (
      this.isProtectedApiPath(pathname) &&
      !this.enforceProtectedRouteAuth(req, res, parsedUrl, method)
    ) {
      return;
    }

    // Route: GET /api/f360/snapshot (Fetch canonical Finance 360 institutional ledger snapshot)
    if (method === 'GET' && pathname === '/api/f360/snapshot') {
      await this.handleGetF360Snapshot(res);
      return;
    }

    // Route: PUT /api/f360/snapshot (Persist canonical Finance 360 institutional ledger snapshot)
    if (method === 'PUT' && pathname === '/api/f360/snapshot') {
      await this.handlePutF360Snapshot(req, res);
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

        let effectiveMsg = msg;
        if (msg.mediaId && msg.mediaType && msg.mediaType !== 'text') {
          const mediaResult = await fetchAndAnalyzeMetaMediaWithGemini({
            mediaId: msg.mediaId,
            mediaType: msg.mediaType,
            mimeType: msg.mediaMimeType,
          });
          if (mediaResult.analyzed && mediaResult.extractedText) {
            effectiveMsg = {
              ...msg,
              text: `${msg.text} ${mediaResult.extractedText}`.trim(),
            };
          }
        }

        const receipt = processInboundMessageToReceipt(effectiveMsg, this.config.targetScope, this.knownDeals);
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

    // Route: GET /api/arm/whatsapp-qr/status (Linked Devices QR bridge status)
    if (method === 'GET' && pathname === '/api/arm/whatsapp-qr/status') {
      this.sendJson(res, 200, {
        ok: true,
        ...this.waQrBridge.getState(),
      });
      return;
    }

    // Route: POST /api/arm/whatsapp-qr/connect (Start Baileys socket and generate QR)
    if (method === 'POST' && pathname === '/api/arm/whatsapp-qr/connect') {
      const state = await this.waQrBridge.connect();
      this.sendJson(res, 200, {
        ok: true,
        ...state,
      });
      return;
    }

    // Route: POST /api/arm/whatsapp-qr/disconnect (Disconnect or wipe linked session)
    if (method === 'POST' && pathname === '/api/arm/whatsapp-qr/disconnect') {
      const rawBody = await this.readRawBody(req);
      let clearSession = false;
      if (rawBody.length > 0) {
        try {
          const parsed = JSON.parse(rawBody.toString('utf8')) as { clearSession?: boolean };
          clearSession = Boolean(parsed.clearSession);
        } catch {
          // ignore malformed optional body
        }
      }
      const state = await this.waQrBridge.disconnect(clearSession);
      this.sendJson(res, 200, {
        ok: true,
        ...state,
      });
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

    // Route: GET /api/arm/health/storage (Storage & PostgreSQL RLS/pgvector status)
    if (method === 'GET' && pathname === '/api/arm/health/storage') {
      const includeDiagnostics =
        parsedUrl.searchParams.get('verbose') === '1' ||
        parsedUrl.searchParams.get('diagnostics') === '1';
      await this.handleStorageHealth(res, includeDiagnostics);
      return;
    }

    // Route: GET & POST /api/arm/meta/config (Omnichannel WhatsApp, Instagram & Facebook setup)
    if (pathname === '/api/arm/meta/config') {
      if (method === 'GET') {
        this.handleGetMetaConfig(res);
        return;
      }
      if (method === 'POST') {
        await this.handleSaveMetaConfig(req, res);
        return;
      }
    }

    // Route: POST /api/arm/receipts/verify (Atomic anti-replay bank reference check)
    if (method === 'POST' && pathname === '/api/arm/receipts/verify') {
      await this.handleVerifyReceipt(req, res);
      return;
    }

    // Route: GET /api/arm/outbox (Replay missed ARM outbox events by cursor & workspace)
    if (method === 'GET' && pathname === '/api/arm/outbox') {
      const sinceId = Number(parsedUrl.searchParams.get('sinceId') || 0);
      const workspaceId = (parsedUrl.searchParams.get('workspaceId') || undefined) as
        | ArmWorkspaceId
        | undefined;
      const events = await this.fetchOutboxEventsSince(sinceId, workspaceId);
      const lastEventId = events.reduce((maxId, evt) => Math.max(maxId, evt.id), this.outboxSeq);
      this.sendJson(res, 200, {
        count: events.length,
        lastEventId,
        events,
      });
      return;
    }

    // Route: POST /api/arm/sandbox/turn (Run $0-cost simulated customer turn & emit SSE outbox events)
    if (method === 'POST' && pathname === '/api/arm/sandbox/turn') {
      const rawBody = await this.readRawBody(req);
      let body: { workspaceId?: ArmWorkspaceId; personaId?: ArmSandboxPersonaId };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const personaId: ArmSandboxPersonaId = body.personaId || 'SKEPTICAL_DISCOUNT_30';
      const simulation = runArmSandboxSimulationTurn({ workspaceId, personaId });

      let emitted = 0;
      await this.persistOutboxEvent(workspaceId, 'pipeline_transition', `sbx-${workspaceId}`, {
        fromStageSlug: simulation.fromStageSlug,
        toStageSlug: simulation.toStageSlug,
        updatedScore: simulation.updatedScore,
        isSandbox: true,
      });
      emitted++;

      if (simulation.queuedApproval) {
        await this.persistOutboxEvent(workspaceId, 'approval_requested', simulation.queuedApproval.id, {
          approval: simulation.queuedApproval,
          isSandbox: true,
        });
        emitted++;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          outboxEventsEmitted: emitted,
          simulation,
        }),
      );
      return;
    }

    // Route: POST /api/arm/outbound/send (Enforces Outbound DLP + Meta 24h Free Window before dispatch)
    if (method === 'POST' && pathname === '/api/arm/outbound/send') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        recipientPhone?: string;
        text?: string;
        templateName?: string;
        lastInboundTimestampMs?: number | null;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const outboundText = body.text || '';

      const dlpCheck = scanOutboundMessageDlp({ workspaceId, outboundText });
      if (!dlpCheck.safe) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'OUTBOUND_DLP_VIOLATION',
            violations: dlpCheck.violations,
          }),
        );
        return;
      }

      const windowEval = evaluateMeta24hFreeWindow(body.lastInboundTimestampMs ?? null);
      const qrActive = this.waQrBridge.isConnected();
      if (!windowEval.isOpen && !body.templateName && !qrActive) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'META_24H_WINDOW_CLOSED_HSM_REQUIRED',
            costStatus: windowEval.costStatus,
          }),
        );
        return;
      }

      let delivery = await dispatchMetaWhatsappMessage({
        workspaceId,
        recipientPhone: body.recipientPhone || '',
        text: outboundText,
        templateName: body.templateName,
      });

      if (
        delivery.mode === 'DRY_RUN_NO_META_CREDENTIALS' &&
        qrActive &&
        body.recipientPhone
      ) {
        const qrRes = await this.waQrBridge.sendText(body.recipientPhone, outboundText);
        if (!qrRes.ok) {
          this.sendJson(res, 502, {
            error: qrRes.error || 'WHATSAPP_QR_SEND_FAILED',
          });
          return;
        }
        delivery = {
          delivered: true,
          workspaceId,
          mode: 'LIVE_WHATSAPP_QR',
          metaMessageId: qrRes.messageId,
        };
      }

      const evt = await this.persistOutboxEvent(
        workspaceId,
        'message_received',
        body.recipientPhone || 'outbound',
        {
          direction: 'OUTBOUND',
          recipientPhone: body.recipientPhone || '',
          text: outboundText,
          templateName: body.templateName || null,
          costStatus: windowEval.costStatus,
          deliveryMode: delivery.mode,
          metaMessageId: delivery.metaMessageId || null,
        },
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          outboxEventId: evt.id,
          costStatus: windowEval.costStatus,
          delivery,
        }),
      );
      return;
    }

    // Route: POST /api/arm/approvals/resolve (1-Click HITL Approval / Edit / Reject)
    if (method === 'POST' && pathname === '/api/arm/approvals/resolve') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        approvalId?: string;
        decision?: ArmApprovalStatus;
        approvedText?: string;
        saveAsExample?: boolean;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const decision: ArmApprovalStatus = body.decision || 'APPROVED';
      const approvalId = body.approvalId || `app-${Date.now()}`;

      const evt = await this.persistOutboxEvent(workspaceId, 'agent_run', approvalId, {
        approvalId,
        decision,
        approvedText: body.approvedText || null,
        saveAsExample: Boolean(body.saveAsExample),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          approvalId,
          decision,
          outboxEventId: evt.id,
        }),
      );
      return;
    }

    // Route: POST /api/arm/replay/dry-run (Deterministic Prompt A/B Replay + Cost Circuit-Breaker)
    if (method === 'POST' && pathname === '/api/arm/replay/dry-run') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        leadName?: string;
        historicalInboundText?: string;
        shadowStore?: ArmShadowExample[];
        agentRole?: ArmAgentRole;
        dailyTokensUsed?: number;
        estimatedTurnTokens?: number;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const circuitBreaker = evaluateDealTokenCircuitBreaker({
        workspaceId,
        dailyTokensUsed: body.dailyTokensUsed ?? 12_400,
        estimatedTurnTokens: body.estimatedTurnTokens ?? 1_850,
      });

      const replay = runArmDeterministicReplayComparison({
        workspaceId,
        leadName: body.leadName || 'Prospecto Histórico',
        historicalInboundText:
          body.historicalInboundText ||
          '¿Qué descuento me dan en el Plan Enterprise si cerramos hoy?',
        shadowStore: body.shadowStore || [],
        agentRole: body.agentRole,
      });

      const evt = await this.persistOutboxEvent(workspaceId, 'agent_run', 'replay-dry-run', {
        replay,
        circuitBreaker,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          replay,
          circuitBreaker,
          outboxEventId: evt.id,
        }),
      );
      return;
    }

    // Route: POST /api/arm/closer/pre-call-briefing (15m Pre-Call Closer Executive Briefing)
    if (method === 'POST' && pathname === '/api/arm/closer/pre-call-briefing') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        leadName?: string;
        companyName?: string;
        startsInMinutes?: number;
        qualificationScore?: number;
        bantData?: ArmBantData;
        memoryFacts?: string[];
        estimatedDealValue?: number;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const briefing = generateCloserPreCallBriefing({
        workspaceId,
        leadName: body.leadName || 'Dra. Elena Gómez',
        companyName: body.companyName || 'Clínica Aurora',
        startsInMinutes: body.startsInMinutes ?? 15,
        qualificationScore: body.qualificationScore ?? 92,
        bantData: body.bantData || {
          budget: '$2,400 USD aprobados',
          authority: 'Directora Médica (Decisora)',
          need_pain_point: 'Migrar de proceso manual en 20 médicos',
          timeline: 'Esta misma semana',
        },
        memoryFacts: body.memoryFacts || ['Solicitó esquema 50/50 o descuento corporativo anual'],
        estimatedDealValue: body.estimatedDealValue ?? 2400,
      });

      const evt = await this.persistOutboxEvent(workspaceId, 'agent_run', 'pre-call-briefing', {
        briefing,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          briefing,
          outboxEventId: evt.id,
        }),
      );
      return;
    }

    // Route: POST /api/arm/closer/post-call (30s Closer Voice-Note Processor)
    if (method === 'POST' && pathname === '/api/arm/closer/post-call') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        leadId?: string;
        leadName?: string;
        voiceNoteTranscript?: string;
        sku?: string;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      if (!body.voiceNoteTranscript || !body.voiceNoteTranscript.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MISSING_TRANSCRIPT' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const defaultSku =
        workspaceId === 'ARM_B2B'
          ? 'PLAN-ENTERPRISE'
          : workspaceId === 'FINANCE_360'
            ? 'PYME-SERV-360'
            : 'USDT-LIQ-DESK';

      const processed = processCloserPostCallNote({
        workspaceId,
        leadId: body.leadId || `closer-${Date.now()}`,
        leadName: body.leadName || 'Prospecto Closer',
        voiceNoteTranscript: body.voiceNoteTranscript.trim(),
        sku: body.sku || defaultSku,
      });

      const evt = await this.persistOutboxEvent(workspaceId, 'approval_requested', processed.approvalEntry.id, {
        approval: processed.approvalEntry,
        recommendedStageSlug: processed.recommendedStageSlug,
        detectedSplitPayment: processed.detectedSplitPayment,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          processed,
          outboxEventId: evt.id,
        }),
      );
      return;
    }

    // Route: POST /api/arm/antighosting/sweep (Proactive Follow-Up Worker Sweep)
    if (method === 'POST' && pathname === '/api/arm/antighosting/sweep') {
      const rawBody = await this.readRawBody(req);
      let body: {
        candidates?: Array<{
          workspaceId: ArmWorkspaceId;
          leadId: string;
          leadName: string;
          lastInboundTimestampMs: number;
          followupAttempts: number;
          painPointMemory: string;
        }>;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const events = await this.runAntiGhostingSweepAsync(body.candidates || []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          queuedCount: events.length,
          events,
        }),
      );
      return;
    }

    // Route: POST /api/arm/tools/execute (Unified Tool Runner for the 10 strict JSON Schema contracts)
    if (method === 'POST' && pathname === '/api/arm/tools/execute') {
      const rawBody = await this.readRawBody(req);
      let body: {
        workspaceId?: ArmWorkspaceId;
        toolName?: string;
        args?: Record<string, unknown>;
        lead?: ArmLeadProfile;
      };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JSON' }));
        return;
      }

      const workspaceId: ArmWorkspaceId = body.workspaceId || 'ARM_B2B';
      const defaultLead: ArmLeadProfile = body.lead || {
        id: 'lead-default',
        workspaceId,
        fullName: 'Prospecto ARM',
        companyName: 'Empresa',
        phoneWhatsapp: '+584140000000',
        email: null,
        currentStageSlug: workspaceId === 'ARM_B2B' ? 'en-descubrimiento' : 'STAGE_1_NEW',
        qualificationScore: 30,
        isQualified: false,
        substantiveTurnsCount: 1,
        bantData: { budget: null, authority: null, need_pain_point: null, timeline: null },
        aiExecutiveSummary: '',
        estimatedDealValue: 0,
        currency: 'USD',
      };

      const execRes = executeArmToolCall({
        workspaceId,
        toolName: body.toolName || '',
        args: body.args || {},
        lead: defaultLead,
      });

      if (!execRes.ok) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(execRes));
        return;
      }

      const evtType: ArmOutboxEventType = execRes.approvalEntry
        ? 'approval_requested'
        : body.toolName === 'transition_pipeline_stage'
          ? 'pipeline_transition'
          : 'agent_run';

      const evt = await this.persistOutboxEvent(workspaceId, evtType, defaultLead.id, {
        ...execRes.outboxPayload,
        approval: execRes.approvalEntry,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ...execRes,
          outboxEventId: evt.id,
        }),
      );
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

      const headerLastId = Number(req.headers['last-event-id'] || 0);
      const queryLastId = Number(parsedUrl.searchParams.get('lastEventId') || 0);
      const resumeCursor = Math.max(headerLastId, queryLastId);
      if (resumeCursor > 0) {
        const missed = await this.fetchOutboxEventsSince(resumeCursor);
        for (const evt of missed) {
          res.write(`id: ${evt.id}\nevent: arm_event\ndata: ${JSON.stringify(evt)}\n\n`);
        }
      }

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

  private applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const rawAllowed = (
      this.config.allowedOrigin ??
      process.env['INBOUND_GATEWAY_ALLOWED_ORIGIN'] ??
      ''
    ).trim();

    if (rawAllowed.length > 0) {
      const allowedOrigins = rawAllowed
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
      res.setHeader('Vary', 'Origin');
      if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      } else if (!reqOrigin && allowedOrigins.length === 1) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256');
  }

  private isProtectedApiPath(pathname: string): boolean {
    return (
      pathname === '/api/arm' ||
      pathname.startsWith('/api/arm/') ||
      pathname === '/api/f360' ||
      pathname.startsWith('/api/f360/') ||
      pathname === '/api/events' ||
      pathname.startsWith('/api/events/')
    );
  }

  private enforceProtectedRouteAuth(
    req: IncomingMessage,
    res: ServerResponse,
    parsedUrl: URL,
    method: string,
  ): boolean {
    const configuredToken = (
      this.config.authToken ??
      process.env['INBOUND_GATEWAY_AUTH_TOKEN'] ??
      ''
    ).trim();

    if (configuredToken.length > 0) {
      let authorized = verifyBearerToken(req.headers.authorization, configuredToken);
      if (
        !authorized &&
        !req.headers.authorization &&
        method === 'GET' &&
        parsedUrl.pathname === '/api/events'
      ) {
        const queryToken = parsedUrl.searchParams.get('token')?.trim();
        if (queryToken) {
          authorized = verifyBearerToken(`Bearer ${queryToken}`, configuredToken);
        }
      }
      if (!authorized) {
        this.sendJson(res, 401, { error: 'UNAUTHORIZED' });
        return false;
      }
      return true;
    }

    if (this.config.requireAuth === true) {
      this.sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return false;
    }

    return true;
  }

  private async handleGetF360Snapshot(res: ServerResponse): Promise<void> {
    if (this.pgStore) {
      const data = await this.pgStore.getFinance360Snapshot();
      const response: F360SnapshotGetResponse = {
        ok: true,
        mode: GATEWAY_STORAGE_MODES.POSTGRES_PGVECTOR,
        workspaceId: 'FINANCE_360',
        found: Boolean(data),
        data,
      };
      this.sendJson(res, 200, response);
      return;
    }

    const response: F360SnapshotGetResponse = {
      ok: true,
      mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
      workspaceId: 'FINANCE_360',
      found: Boolean(this.memoryF360Snapshot),
      data: this.memoryF360Snapshot,
    };
    this.sendJson(res, 200, response);
  }

  private async handlePutF360Snapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await this.readRawBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'INVALID_JSON' });
      return;
    }

    const validated = this.validateF360SnapshotPayload(parsed);
    if (!validated.ok) {
      this.sendJson(res, 400, { ok: false, error: validated.error });
      return;
    }

    if (this.pgStore) {
      try {
        const saved = await this.pgStore.saveFinance360Snapshot(validated.data);
        const response: F360SnapshotPutResponse = {
          ok: true,
          mode: GATEWAY_STORAGE_MODES.POSTGRES_PGVECTOR,
          workspaceId: 'FINANCE_360',
          version: saved.version,
          checksum: saved.checksum,
          updatedAt: saved.updatedAt,
        };
        this.sendJson(res, 200, response);
      } catch (err: unknown) {
        const isUniqueViolation =
          typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
        if (isUniqueViolation) {
          this.sendJson(res, 409, { ok: false, error: 'DUPLICATE_REFERENCE' });
          return;
        }
        throw err;
      }
      return;
    }

    const serialized = JSON.stringify(validated.data);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    const updatedAt = Date.now();
    const version = (this.memoryF360Snapshot?.version ?? 0) + 1;
    const schemaVersion = Math.max(1, Math.round(Number(validated.data.version || 2)));

    this.memoryF360Snapshot = {
      workspaceId: 'FINANCE_360',
      version,
      schemaVersion,
      checksum,
      updatedAt,
      snapshot: validated.data,
    };

    const response: F360SnapshotPutResponse = {
      ok: true,
      mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
      workspaceId: 'FINANCE_360',
      version,
      checksum,
      updatedAt,
    };
    this.sendJson(res, 200, response);
  }

  private validateF360SnapshotPayload(
    input: unknown,
  ): { ok: true; data: F360SnapshotPayload } | { ok: false; error: string } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, error: 'INVALID_SNAPSHOT_PAYLOAD' };
    }
    const record = input as Record<string, unknown>;
    if (record['workspaceId'] !== undefined && record['workspaceId'] !== 'FINANCE_360') {
      return { ok: false, error: 'INVALID_WORKSPACE_ID' };
    }
    const requiredArrayKeys = [
      'assets',
      'liabilities',
      'incomes',
      'expenses',
      'casheaPlans',
      'providers',
      'inventory',
      'quotes',
    ];
    for (const key of requiredArrayKeys) {
      if (!Array.isArray(record[key])) {
        return { ok: false, error: `MISSING_OR_INVALID_${key.toUpperCase()}` };
      }
    }
    return { ok: true, data: input as F360SnapshotPayload };
  }

  private async handleStorageHealth(
    res: ServerResponse,
    includeDiagnostics = false,
  ): Promise<void> {
    if (!this.pgStore) {
      const payload: StorageHealthResponse = {
        ok: true,
        mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
        postgresConnected: false,
        rlsActive: false,
        ...(includeDiagnostics
          ? { pgvectorAvailable: false, outboxListenerConnected: false }
          : {}),
      };
      this.sendJson(res, 200, payload);
      return;
    }

    const health = await this.pgStore.healthCheck();
    const warnings =
      typeof this.pgStore.getConnectionWarnings === 'function'
        ? this.pgStore.getConnectionWarnings()
        : [];
    const listenerConnected =
      typeof this.pgStore.isOutboxListenerConnected === 'function'
        ? this.pgStore.isOutboxListenerConnected()
        : Boolean(this.outboxListener);
    const payload: StorageHealthResponse = {
      ok: health.connected,
      mode: GATEWAY_STORAGE_MODES.POSTGRES_PGVECTOR,
      postgresConnected: health.connected,
      latencyMs: health.latencyMs,
      rlsActive: health.rlsActive,
      ...(includeDiagnostics
        ? {
            pgvectorAvailable: health.pgvectorInstalled,
            outboxListenerConnected: listenerConnected,
          }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(health.error ? { error: health.error } : {}),
    };
    this.sendJson(res, health.connected ? 200 : 503, payload);
  }

  private handleGetMetaConfig(res: ServerResponse): void {
    const phoneId =
      process.env['META_PHONE_NUMBER_ID']?.trim() ||
      process.env['META_PHONE_NUMBER_ID_P2P']?.trim() ||
      process.env['META_PHONE_NUMBER_ID_B2B']?.trim() ||
      process.env['META_PHONE_NUMBER_ID_360']?.trim() ||
      '';
    const hasAccessToken = Boolean(process.env['META_ACCESS_TOKEN']?.trim());
    const hasAppSecret = Boolean(
      (this.config.metaAppSecret ?? process.env['META_APP_SECRET'])?.trim(),
    );

    this.sendJson(res, 200, {
      ok: true,
      mode: hasAccessToken && phoneId ? 'LIVE_META_GRAPH' : 'DRY_RUN_NO_META_CREDENTIALS',
      phoneNumberId: phoneId,
      phoneNumberIdB2b: process.env['META_PHONE_NUMBER_ID_B2B']?.trim() || phoneId,
      phoneNumberIdP2p: process.env['META_PHONE_NUMBER_ID_P2P']?.trim() || phoneId,
      phoneNumberId360: process.env['META_PHONE_NUMBER_ID_360']?.trim() || phoneId,
      whatsappDisplayPhone: process.env['META_WHATSAPP_DISPLAY_PHONE']?.trim() || '',
      igBusinessAccountId: process.env['META_IG_BUSINESS_ACCOUNT_ID']?.trim() || '',
      fbPageId: process.env['META_FB_PAGE_ID']?.trim() || '',
      verifyToken:
        this.config.metaVerifyToken ||
        process.env['META_VERIFY_TOKEN']?.trim() ||
        'p2p-verify-secret',
      hasAccessToken,
      hasAppSecret,
    });
  }

  private async handleSaveMetaConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await this.readRawBody(req);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.sendJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      body = parsed as Record<string, unknown>;
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'INVALID_JSON' });
      return;
    }

    const str = (k: string): string | undefined =>
      typeof body[k] === 'string' ? (body[k] as string).trim() : undefined;

    const sharedPhoneId = str('phoneNumberId');
    const updates: Record<string, string> = {};

    if (sharedPhoneId !== undefined) {
      updates['META_PHONE_NUMBER_ID'] = sharedPhoneId;
      updates['META_PHONE_NUMBER_ID_B2B'] = str('phoneNumberIdB2b') || sharedPhoneId;
      updates['META_PHONE_NUMBER_ID_P2P'] = str('phoneNumberIdP2p') || sharedPhoneId;
      updates['META_PHONE_NUMBER_ID_360'] = str('phoneNumberId360') || sharedPhoneId;
    } else {
      if (str('phoneNumberIdB2b') !== undefined) {
        updates['META_PHONE_NUMBER_ID_B2B'] = str('phoneNumberIdB2b')!;
      }
      if (str('phoneNumberIdP2p') !== undefined) {
        updates['META_PHONE_NUMBER_ID_P2P'] = str('phoneNumberIdP2p')!;
      }
      if (str('phoneNumberId360') !== undefined) {
        updates['META_PHONE_NUMBER_ID_360'] = str('phoneNumberId360')!;
      }
    }

    if (str('whatsappDisplayPhone') !== undefined) {
      updates['META_WHATSAPP_DISPLAY_PHONE'] = str('whatsappDisplayPhone')!;
    }
    if (str('igBusinessAccountId') !== undefined) {
      updates['META_IG_BUSINESS_ACCOUNT_ID'] = str('igBusinessAccountId')!;
    }
    if (str('fbPageId') !== undefined) {
      updates['META_FB_PAGE_ID'] = str('fbPageId')!;
    }
    if (str('verifyToken') !== undefined && str('verifyToken')!.length > 0) {
      updates['META_VERIFY_TOKEN'] = str('verifyToken')!;
      this.config.metaVerifyToken = str('verifyToken')!;
    }
    if (str('accessToken') !== undefined && str('accessToken')!.length > 0) {
      updates['META_ACCESS_TOKEN'] = str('accessToken')!;
    }
    if (str('appSecret') !== undefined && str('appSecret')!.length > 0) {
      updates['META_APP_SECRET'] = str('appSecret')!;
      this.config.metaAppSecret = str('appSecret')!;
    }

    for (const [k, v] of Object.entries(updates)) {
      process.env[k] = v;
    }

    if (process.env['NODE_ENV'] !== 'test' && !process.env['VITEST'] && body['persistToEnv'] !== false) {
      try {
        const repoRoot = findMonorepoRoot(process.cwd());
        const envPath = join(repoRoot, '.env');
        let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        for (const [k, v] of Object.entries(updates)) {
          const line = `${k}=${v}`;
          const re = new RegExp(`^${k}=.*$`, 'm');
          content = re.test(content)
            ? content.replace(re, line)
            : `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`;
        }
        writeFileSync(envPath, content, 'utf8');
      } catch {
        // Non-fatal if read-only fs
      }
    }

    this.handleGetMetaConfig(res);
  }

  private async handleVerifyReceipt(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await this.readRawBody(req);
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'INVALID_JSON' });
      return;
    }

    const validated = this.validateReceiptVerifyPayload(rawJson);
    if (!validated.ok) {
      this.sendJson(res, 400, { ok: false, error: validated.error });
      return;
    }

    const parsedReq = validated.data;
    if (this.pgStore) {
      const result = await this.pgStore.recordPaymentReceipt({
        workspaceId: parsedReq.workspaceId,
        bankRailId: parsedReq.bankRailId,
        referenceCode: parsedReq.referenceCode,
        amountFiat: parsedReq.amountFiat,
        currency: parsedReq.currency,
        dealId: parsedReq.dealId,
        senderName: parsedReq.senderName,
        rawText: parsedReq.rawText,
        channel: parsedReq.channel,
      });

      const response: ReceiptVerifyResponse = {
        ok: !result.collision,
        mode: GATEWAY_STORAGE_MODES.POSTGRES_PGVECTOR,
        recorded: result.recorded,
        collision: result.collision,
        workspaceId: parsedReq.workspaceId,
        bankRailId: parsedReq.bankRailId,
        normalizedReference: result.normalizedReference,
        ...(result.receipt?.id ? { receiptId: result.receipt.id } : {}),
        ...(result.existingReceiptId ? { existingReceiptId: result.existingReceiptId } : {}),
        ...(result.collision
          ? { existingDealId: result.existingDealId ?? null }
          : result.receipt
            ? { dealId: result.receipt.dealId }
            : {}),
      };
      this.sendJson(res, result.collision ? 409 : 200, response);
      return;
    }

    const normalizedRef = normalizeBankReference(parsedReq.referenceCode);
    const dedupKey = `${parsedReq.workspaceId}::${parsedReq.bankRailId}::${normalizedRef}`;
    const existingEntry = this.memoryVerifiedReceipts.get(dedupKey);
    if (existingEntry) {
      const collisionResp: ReceiptVerifyResponse = {
        ok: false,
        mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
        recorded: false,
        collision: true,
        workspaceId: parsedReq.workspaceId,
        bankRailId: parsedReq.bankRailId,
        normalizedReference: normalizedRef,
        existingReceiptId: existingEntry.receiptId,
        existingDealId: existingEntry.dealId,
      };
      this.sendJson(res, 409, collisionResp);
      return;
    }

    const receiptId = `mem-rcpt-${randomUUID()}`;
    const dealId = parsedReq.dealId?.trim() || null;
    this.memoryVerifiedReceipts.set(dedupKey, { receiptId, dealId });
    const okResp: ReceiptVerifyResponse = {
      ok: true,
      mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
      recorded: true,
      collision: false,
      workspaceId: parsedReq.workspaceId,
      bankRailId: parsedReq.bankRailId,
      normalizedReference: normalizedRef,
      receiptId,
      dealId,
    };
    this.sendJson(res, 200, okResp);
  }

  private validateReceiptVerifyPayload(
    input: unknown,
  ): { ok: true; data: ReceiptVerifyRequest } | { ok: false; error: string } {
    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    const record = input as Record<string, unknown>;
    if (!isArmWorkspaceId(record['workspaceId'])) {
      return { ok: false, error: 'INVALID_WORKSPACE_ID' };
    }
    const bankRailId = typeof record['bankRailId'] === 'string' ? record['bankRailId'].trim() : '';
    if (!bankRailId) {
      return { ok: false, error: 'MISSING_BANK_RAIL_ID' };
    }
    const rawRef = typeof record['referenceCode'] === 'string' ? record['referenceCode'] : '';
    const normalizedRef = normalizeBankReference(rawRef);
    if (!normalizedRef || normalizedRef.length < 4) {
      return { ok: false, error: 'INVALID_REFERENCE_CODE' };
    }
    const amountFiat = record['amountFiat'];
    if (typeof amountFiat !== 'number' || !Number.isFinite(amountFiat) || amountFiat <= 0) {
      return { ok: false, error: 'INVALID_AMOUNT_FIAT' };
    }

    return {
      ok: true,
      data: {
        workspaceId: record['workspaceId'],
        bankRailId,
        referenceCode: normalizedRef,
        amountFiat,
        currency: typeof record['currency'] === 'string' ? record['currency'].trim() : undefined,
        dealId: typeof record['dealId'] === 'string' ? record['dealId'].trim() || undefined : undefined,
        senderName:
          typeof record['senderName'] === 'string' ? record['senderName'].trim() || undefined : undefined,
        rawText: typeof record['rawText'] === 'string' ? record['rawText'] : undefined,
        channel: typeof record['channel'] === 'string' ? record['channel'].trim() || undefined : undefined,
      },
    };
  }

  private async runAntiGhostingSweepAsync(
    candidates: ReadonlyArray<{
      workspaceId: ArmWorkspaceId;
      leadId: string;
      leadName: string;
      lastInboundTimestampMs: number;
      followupAttempts: number;
      painPointMemory: string;
    }>,
    nowTimestampMs = Date.now(),
  ): Promise<ArmOutboxSseEvent[]> {
    if (!this.pgStore) {
      return this.runAntiGhostingSweep(candidates, nowTimestampMs);
    }

    const queued: ArmOutboxSseEvent[] = [];
    for (const c of candidates) {
      const res = evaluateGhostingFollowUp({
        workspaceId: c.workspaceId,
        leadId: c.leadId,
        leadName: c.leadName,
        lastInboundTimestampMs: c.lastInboundTimestampMs,
        nowTimestampMs,
        followupAttempts: c.followupAttempts,
        painPointMemory: c.painPointMemory,
      });
      if (res.shouldQueueFollowUp && res.approvalEntry) {
        queued.push(
          await this.persistOutboxEvent(c.workspaceId, 'approval_requested', res.approvalEntry.id, {
            approval: res.approvalEntry,
            requiresHsmTemplate: res.requiresHsmTemplate,
          }),
        );
      }
    }
    return queued;
  }

  private async persistOutboxEvent(
    workspaceId: ArmWorkspaceId,
    eventType: ArmOutboxEventType,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<ArmOutboxSseEvent> {
    if (!this.pgStore) {
      return this.appendArmOutboxEvent(workspaceId, eventType, aggregateId, payload);
    }

    try {
      const evt = await this.pgStore.appendOutboxEvent(workspaceId, eventType, aggregateId, payload);
      this.recordAndBroadcastOutboxEvent(evt);
      return evt;
    } catch (err: unknown) {
      console.warn(
        '[P2P-INBOUND-GATEWAY] PG outbox append failed, using memory fallback:',
        err instanceof Error ? err.message : String(err),
      );
      return this.appendArmOutboxEvent(workspaceId, eventType, aggregateId, payload);
    }
  }

  private async fetchOutboxEventsSince(
    sinceId = 0,
    workspaceId?: ArmWorkspaceId,
  ): Promise<ArmOutboxSseEvent[]> {
    if (!this.pgStore) {
      return this.getOutboxEventsSince(sinceId, workspaceId);
    }
    try {
      return await this.pgStore.getOutboxEventsSince(sinceId, workspaceId);
    } catch (err: unknown) {
      console.warn(
        '[P2P-INBOUND-GATEWAY] PG outbox query failed, using memory fallback:',
        err instanceof Error ? err.message : String(err),
      );
      return this.getOutboxEventsSince(sinceId, workspaceId);
    }
  }

  private handlePgOutboxNotification(evt: ArmOutboxSseEvent): void {
    if (this.seenPgOutboxIds.has(evt.id)) {
      return;
    }
    this.recordAndBroadcastOutboxEvent(evt);
  }

  private recordAndBroadcastOutboxEvent(evt: ArmOutboxSseEvent): void {
    this.seenPgOutboxIds.add(evt.id);
    if (this.seenPgOutboxIds.size > 2000) {
      const oldest = this.seenPgOutboxIds.values().next().value;
      if (typeof oldest === 'number') {
        this.seenPgOutboxIds.delete(oldest);
      }
    }
    this.outboxSeq = Math.max(this.outboxSeq, evt.id);
    this.outboxEvents.push(evt);
    if (this.outboxEvents.length > 1000) {
      this.outboxEvents.shift();
    }
    this.broadcastSseEvent('arm_event', evt, evt.id);
  }

  private async handleWhatsAppQrInbound(msg: WhatsAppQrMessageEvent): Promise<void> {
    const dedupKey = `${msg.direction}:${msg.eventId}`;
    if (this.dedupCache.checkAndRecord(dedupKey)) {
      return;
    }

    const receipt =
      msg.direction === 'INBOUND'
        ? processInboundMessageToReceipt(msg, this.config.targetScope, this.knownDeals)
        : null;
    if (receipt) {
      this.pendingEvents.push(receipt);
      this.broadcastSseEvent('new_receipt', receipt);
    }

    const defaultWorkspace: ArmWorkspaceId =
      this.config.targetScope === 'FINANCE_360' ? 'FINANCE_360' : 'P2P_DESK';
    await this.persistOutboxEvent(defaultWorkspace, 'message_received', msg.sender.id, {
      direction: msg.direction,
      channel: 'WHATSAPP',
      transport: 'WHATSAPP_QR',
      senderPhone: msg.sender.id,
      ...(msg.direction === 'OUTBOUND' ? { recipientPhone: msg.sender.id } : {}),
      senderName: msg.sender.name || msg.sender.id,
      text: msg.text,
      mediaType: msg.mediaType || 'text',
      timestamp: msg.timestamp,
      receiptDetected: Boolean(receipt),
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private broadcastSseEvent(event: string, data: unknown, id?: number): void {
    const idPrefix = typeof id === 'number' ? `id: ${id}\n` : '';
    const payload = `${idPrefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
