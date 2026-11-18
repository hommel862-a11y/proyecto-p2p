import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';
import type {
  GatewayConfig,
  InboundReceiptEvent,
  InboundNormalizedMessage,
  ArmOutboxSseEvent,
  ArmOutboxEventType,
} from './types.js';
import { verifyMetaSignature, verifyBearerToken } from './crypto-verify.js';
import { DedupCache } from './dedup-cache.js';
import { parseMetaWebhookPayload } from './meta-webhook-parser.js';
import { processInboundMessageToReceipt } from './receipt-intake.js';
import {
  dispatchMetaWhatsappMessage,
  fetchAndAnalyzeMetaMediaWithGemini,
} from './meta-outbound-client.js';
import {
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
  private readonly pendingEvents: InboundReceiptEvent[] = [];
  private readonly outboxEvents: ArmOutboxSseEvent[] = [];
  private outboxSeq = 0;
  private readonly coalesceBuffers: Map<string, string[]> = new Map();
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

    // Route: GET /api/events/pending (Desktop app pulls pending receipts)
    if (method === 'GET' && pathname === '/api/events/pending') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: this.pendingEvents.length,
        events: this.pendingEvents,
      }));
      return;
    }

    // Route: GET /api/arm/outbox (Replay missed ARM outbox events by cursor & workspace)
    if (method === 'GET' && pathname === '/api/arm/outbox') {
      const sinceId = Number(parsedUrl.searchParams.get('sinceId') || 0);
      const workspaceId = (parsedUrl.searchParams.get('workspaceId') || undefined) as
        | ArmWorkspaceId
        | undefined;
      const events = this.getOutboxEventsSince(sinceId, workspaceId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          count: events.length,
          lastEventId: this.outboxSeq,
          events,
        }),
      );
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
      this.appendArmOutboxEvent(workspaceId, 'pipeline_transition', `sbx-${workspaceId}`, {
        fromStageSlug: simulation.fromStageSlug,
        toStageSlug: simulation.toStageSlug,
        updatedScore: simulation.updatedScore,
        isSandbox: true,
      });
      emitted++;

      if (simulation.queuedApproval) {
        this.appendArmOutboxEvent(workspaceId, 'approval_requested', simulation.queuedApproval.id, {
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
      if (!windowEval.isOpen && !body.templateName) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'META_24H_WINDOW_CLOSED_HSM_REQUIRED',
            costStatus: windowEval.costStatus,
          }),
        );
        return;
      }

      const delivery = await dispatchMetaWhatsappMessage({
        workspaceId,
        recipientPhone: body.recipientPhone || '',
        text: outboundText,
        templateName: body.templateName,
      });

      const evt = this.appendArmOutboxEvent(
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

      const evt = this.appendArmOutboxEvent(workspaceId, 'agent_run', approvalId, {
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

      const evt = this.appendArmOutboxEvent(workspaceId, 'agent_run', 'replay-dry-run', {
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

      const evt = this.appendArmOutboxEvent(workspaceId, 'agent_run', 'pre-call-briefing', {
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

      const evt = this.appendArmOutboxEvent(workspaceId, 'approval_requested', processed.approvalEntry.id, {
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

      const events = this.runAntiGhostingSweep(body.candidates || []);
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

      const evt = this.appendArmOutboxEvent(workspaceId, evtType, defaultLead.id, {
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
        const missed = this.getOutboxEventsSince(resumeCursor);
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
