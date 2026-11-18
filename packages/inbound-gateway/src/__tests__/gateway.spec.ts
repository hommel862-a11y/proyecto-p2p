import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyMetaSignature,
  verifyBearerToken,
} from '../crypto-verify.js';
import { DedupCache } from '../dedup-cache.js';
import { parseMetaWebhookPayload } from '../meta-webhook-parser.js';
import { processInboundMessageToReceipt } from '../receipt-intake.js';
import { InboundGatewayServer } from '../server.js';
import type { PipelineDeal } from '@p2p/core';

describe('Inbound Gateway - Crypto Verification', () => {
  const secret = 'test-meta-app-secret-12345';
  const payload = JSON.stringify({ test: 'hello world' });

  it('validates a correct HMAC-SHA256 signature', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    const signature = `sha256=${hmac}`;

    expect(verifyMetaSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects tampered payload or incorrect signature', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    const signature = `sha256=${hmac}`;

    expect(verifyMetaSignature(payload + 'tampered', signature, secret)).toBe(false);
    expect(verifyMetaSignature(payload, signature, 'wrong-secret')).toBe(false);
  });

  it('rejects missing or malformed signature headers', () => {
    expect(verifyMetaSignature(payload, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(payload, '', secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'sha1=12345', secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'sha256=invalid-length', secret)).toBe(false);
  });

  it('validates Bearer authorization tokens with timing protection', () => {
    const token = 'super-secure-token-xyz';
    expect(verifyBearerToken(`Bearer ${token}`, token)).toBe(true);
    expect(verifyBearerToken(`bearer ${token}`, token)).toBe(true);
    expect(verifyBearerToken(`Bearer wrong-token`, token)).toBe(false);
    expect(verifyBearerToken(`Basic ${token}`, token)).toBe(false);
    expect(verifyBearerToken(undefined, token)).toBe(false);
    expect(verifyBearerToken('', token)).toBe(false);
  });
});

describe('Inbound Gateway - Deduplication Cache', () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache(10); // 10 seconds TTL
  });

  afterEach(() => {
    cache.destroy();
  });

  it('records new events and flags duplicate arrivals', () => {
    const eventId = 'evt-whatsapp-1001';
    expect(cache.checkAndRecord(eventId)).toBe(false); // First arrival: recorded, not duplicate
    expect(cache.checkAndRecord(eventId)).toBe(true); // Second arrival: duplicate!
    expect(cache.has(eventId)).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('prunes expired keys based on simulated time', () => {
    const baseTime = 1000000;
    cache.checkAndRecord('evt-1', baseTime);
    cache.checkAndRecord('evt-2', baseTime + 5000);

    expect(cache.prune(baseTime + 11000)).toBe(1); // evt-1 expired (+10s), evt-2 still active
    expect(cache.has('evt-1', baseTime + 11000)).toBe(false);
    expect(cache.has('evt-2', baseTime + 11000)).toBe(true);
  });
});

describe('Inbound Gateway - Meta Webhook Parser', () => {
  it('extracts WhatsApp text messages and sender identities', () => {
    const sampleWhatsAppPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Juan Trader' }, wa_id: '584121234567' }],
                messages: [
                  {
                    from: '584121234567',
                    id: 'wamid.HBgNNTg0MTIxMjM0NTY3FQIAERgSRjQ1',
                    timestamp: '1740000000',
                    type: 'text',
                    text: {
                      body: 'Pago Movil Banesco 12345678 Ref: 889900 por Bs. 5,000.00',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const messages = parseMetaWebhookPayload(sampleWhatsAppPayload);
    expect(messages).toHaveLength(1);
    expect(messages[0].channel).toBe('WHATSAPP');
    expect(messages[0].sender.id).toBe('584121234567');
    expect(messages[0].sender.name).toBe('Juan Trader');
    expect(messages[0].text).toContain('Ref: 889900');
  });

  it('extracts Instagram direct messages', () => {
    const sampleIgPayload = {
      object: 'instagram',
      entry: [
        {
          id: 'IG_PAGE_ID',
          messaging: [
            {
              sender: { id: '987654321' },
              recipient: { id: 'IG_PAGE_ID' },
              timestamp: 1740000100000,
              message: {
                mid: 'm_mid12345',
                text: 'Te transferí por Mercantil comprobante 00998877',
              },
            },
          ],
        },
      ],
    };

    const messages = parseMetaWebhookPayload(sampleIgPayload);
    expect(messages).toHaveLength(1);
    expect(messages[0].channel).toBe('INSTAGRAM');
    expect(messages[0].sender.id).toBe('987654321');
    expect(messages[0].text).toContain('00998877');
  });
});

describe('Inbound Gateway - Receipt Intake Engine', () => {
  it('parses bank transfer text into structured receipt events', () => {
    const message = {
      eventId: 'evt-banesco-01',
      channel: 'WHATSAPP' as const,
      sender: { id: '584140000000', name: 'Maria OTC', channel: 'WHATSAPP' as const },
      text: 'BANESCO: Pago Movil recibido de Pedro Perez por Bs. 15.000,00. Ref: 77889900',
      timestamp: Date.now(),
    };

    const receipt = processInboundMessageToReceipt(message, 'P2P_DESK', []);
    expect(receipt).not.toBeNull();
    expect(receipt?.parsed.amountFiat).toBe(15000);
    expect(receipt?.parsed.referenceId).toBe('77889900');
    expect(receipt?.status).toBe('AUTO_MATCHED');
    expect(receipt?.scope).toBe('P2P_DESK');
  });

  it('detects duplicate reference collision against existing CRM deals', () => {
    const existingDeals: PipelineDeal[] = [
      {
        id: 'deal-existing-1',
        title: 'Deal 1',
        scope: 'P2P_DESK',
        contactId: 'c1',
        contactName: 'Pedro',
        bankAccountId: 'bnk-1',
        bankName: 'Banesco',
        stage: 'STAGE_2_TRANSIT',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 100,
        appliedRate: 50,
        replacementRate: 50,
        totalFiatAmount: 5000,
        paidFiatAmount: 5000,
        netProfitUsdt: 2,
        bankReferenceId: '77889900',
        quoteTtlMinutes: 15,
        quotedAt: Date.now(),
        isRateExpired: false,
        timeline: [],
        createdAt: Date.now(),
        closedAt: null,
      },
    ];

    const message = {
      eventId: 'evt-banesco-dup',
      channel: 'WHATSAPP' as const,
      sender: { id: '584140000000', name: 'Maria OTC', channel: 'WHATSAPP' as const },
      text: 'Pago Movil recibido por Bs 5.000,00 Referencia: 77889900',
      timestamp: Date.now(),
    };

    const receipt = processInboundMessageToReceipt(message, 'P2P_DESK', existingDeals);
    expect(receipt).not.toBeNull();
    expect(receipt?.status).toBe('DUPLICATE_FLAGGED');
  });

  it('returns null for non-financial chat messages', () => {
    const chatMsg = {
      eventId: 'evt-chat',
      channel: 'WHATSAPP' as const,
      sender: { id: '584140000000', name: 'Friend', channel: 'WHATSAPP' as const },
      text: 'Hola amigo, como estas? A que tasa tienes el USDT hoy?',
      timestamp: Date.now(),
    };

    const receipt = processInboundMessageToReceipt(chatMsg, 'P2P_DESK', []);
    expect(receipt).toBeNull();
  });
});

describe('Inbound Gateway - Server Endpoints', () => {
  let server: InboundGatewayServer;
  let port: number;
  const verifyToken = 'test-verify-token-xyz';
  const appSecret = 'webhook-secret-4321';
  const apiToken = 'api-bearer-key-999';

  beforeEach(async () => {
    server = new InboundGatewayServer({
      port: 0, // OS assigns available ephemeral port
      metaAppSecret: appSecret,
      metaVerifyToken: verifyToken,
      apiSecretToken: apiToken,
      targetScope: 'P2P_DESK',
      idempotencyTtlSeconds: 60,
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('GET /health returns 200 and gateway status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('UP');
    expect(typeof body.cachedEvents).toBe('number');
  });

  it('GET /webhook/meta verifies Meta challenge subscription correctly', async () => {
    const validUrl = `http://127.0.0.1:${port}/webhook/meta?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=11223344`;
    const res = await fetch(validUrl);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('11223344');

    const invalidUrl = `http://127.0.0.1:${port}/webhook/meta?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=11223344`;
    const badRes = await fetch(invalidUrl);
    expect(badRes.status).toBe(403);
  });

  it('POST /webhook/meta processes incoming receipts with valid HMAC signature', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_1',
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: '584141112233',
                    id: 'wamid.123',
                    timestamp: 1740000000,
                    type: 'text',
                    text: { body: 'Transferencia Banesco Bs 10.000,00 Ref: 99887766' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const signature = `sha256=${createHmac('sha256', appSecret).update(payload).digest('hex')}`;

    const res = await fetch(`http://127.0.0.1:${port}/webhook/meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newReceiptsDetected).toBe(1);

    // Verify pending events queue
    const pending = server.getPendingEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0].parsed.referenceId).toBe('99887766');
    expect(pending[0].parsed.amountFiat).toBe(10000);
  });

  it('POST /api/inbound/receipt accepts manual receipts with Bearer authentication', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/inbound/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        text: 'Pago Movil recibido por Bs. 8.500,00 Ref: 12345600',
        sender: 'ops@desk.com',
        channel: 'GMAIL',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.receiptDetected).toBe(true);
    expect(body.receipt.parsed.referenceId).toBe('12345600');
  });

  it('POST /api/inbound/receipt rejects unauthorized requests', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/inbound/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-key',
      },
      body: JSON.stringify({ text: 'sample' }),
    });

    expect(res.status).toBe(401);
  });

  it('extracts captionless receipt images and WhatsApp voice notes without dropping them (S5)', () => {
    const mediaPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_MEDIA',
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ profile: { name: 'Dra. Gómez' }, wa_id: '584149998877' }],
                messages: [
                  {
                    from: '584149998877',
                    id: 'wamid.audio.01',
                    timestamp: '1740000200',
                    type: 'audio',
                    audio: { id: 'media-audio-123', mime_type: 'audio/ogg; codecs=opus', voice: true },
                  },
                  {
                    from: '584149998877',
                    id: 'wamid.image.02',
                    timestamp: '1740000205',
                    type: 'image',
                    image: { id: 'media-img-456', mime_type: 'image/jpeg' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaWebhookPayload(mediaPayload);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].mediaId).toBe('media-audio-123');
    expect(parsed[0].mediaType).toBe('voice');
    expect(parsed[0].text).toContain('[Nota de Voz]');
    expect(parsed[1].mediaId).toBe('media-img-456');
    expect(parsed[1].mediaType).toBe('image');
    expect(parsed[1].text).toContain('[Imagen Adjunta]');
  });

  it('coalesces burst messages in 3s debounce window and serves POST /api/arm/sandbox/turn + outbox cursor (S2, S5)', async () => {
    server.ingestBurstMessageForCoalescing('ARM_B2B:conv-1', 'Hola');
    server.ingestBurstMessageForCoalescing('ARM_B2B:conv-1', 'Somos 18 médicos en Clínica Aurora');
    server.ingestBurstMessageForCoalescing('ARM_B2B:conv-1', '¿Cuánto cuesta el Plan Enterprise anual?');

    const coalesced = server.flushCoalescedConversation('ARM_B2B:conv-1');
    expect(coalesced).not.toBeNull();
    expect(coalesced?.messageCount).toBe(3);
    expect(coalesced?.combinedText).toBe(
      'Hola\nSomos 18 médicos en Clínica Aurora\n¿Cuánto cuesta el Plan Enterprise anual?',
    );

    const sbxRes = await fetch(`http://127.0.0.1:${port}/api/arm/sandbox/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        personaId: 'SKEPTICAL_DISCOUNT_30',
      }),
    });
    expect(sbxRes.status).toBe(200);
    const sbxBody = await sbxRes.json();
    expect(sbxBody.success).toBe(true);
    expect(sbxBody.simulation.isSandbox).toBe(true);
    expect(sbxBody.outboxEventsEmitted).toBeGreaterThanOrEqual(2);

    const outboxRes = await fetch(`http://127.0.0.1:${port}/api/arm/outbox?sinceId=0&workspaceId=ARM_B2B`);
    expect(outboxRes.status).toBe(200);
    const outboxData = await outboxRes.json();
    expect(outboxData.events.length).toBeGreaterThanOrEqual(2);
    expect(outboxData.events[0].workspaceId).toBe('ARM_B2B');
  });

  it('resolves HITL approvals via POST /api/arm/approvals/resolve and enforces Outbound DLP + Meta 24h window in POST /api/arm/outbound/send (S3, S4, S5)', async () => {
    // 1. Outbound DLP blocks cross-silo P2P bank rails inside ARM_B2B
    const dlpRes = await fetch(`http://127.0.0.1:${port}/api/arm/outbound/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        recipientPhone: '+584141112233',
        text: 'Transfiere por Pago Móvil 0134-1234 para liberar USDT.',
        lastInboundTimestampMs: Date.now() - 1000 * 60 * 30, // 30m ago (window open)
      }),
    });
    expect(dlpRes.status).toBe(422);
    const dlpBody = await dlpRes.json();
    expect(dlpBody.error).toBe('OUTBOUND_DLP_VIOLATION');
    expect(dlpBody.violations).toContain('CROSS_SILO_P2P_RAIL_IN_B2B');

    // 2. Expired Meta 24h window blocks free-text outbound unless templateName is provided
    const expiredRes = await fetch(`http://127.0.0.1:${port}/api/arm/outbound/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        recipientPhone: '+584141112233',
        text: 'Hola Dra. Gómez, seguimiento libre fuera de 24h',
        lastInboundTimestampMs: Date.now() - 1000 * 3600 * 48, // 48h ago (window closed)
      }),
    });
    expect(expiredRes.status).toBe(409);
    const expiredBody = await expiredRes.json();
    expect(expiredBody.error).toBe('META_24H_WINDOW_CLOSED_HSM_REQUIRED');

    // 3. Approval resolution endpoint records decision and emits SSE outbox event
    const resolveRes = await fetch(`http://127.0.0.1:${port}/api/arm/approvals/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        approvalId: 'app-test-204',
        decision: 'EDITED_AND_APPROVED',
        approvedText: 'Dra. Gómez, dirección autorizó el 15% de descuento anual.',
        saveAsExample: true,
      }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveBody = await resolveRes.json();
    expect(resolveBody.success).toBe(true);
    expect(resolveBody.decision).toBe('EDITED_AND_APPROVED');
  });

  it('executes POST /api/arm/replay/dry-run and POST /api/arm/closer/pre-call-briefing (T7)', async () => {
    const replayRes = await fetch(`http://127.0.0.1:${port}/api/arm/replay/dry-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        leadName: 'Clínica Aurora',
        historicalInboundText: '¿Qué descuento me dan en el Plan Enterprise?',
        dailyTokensUsed: 15000,
        estimatedTurnTokens: 2000,
      }),
    });
    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as {
      success: boolean;
      replay: { metaApiCostUsd: number };
      circuitBreaker: { tripped: boolean };
    };
    expect(replayBody.success).toBe(true);
    expect(replayBody.replay.metaApiCostUsd).toBe(0);
    expect(replayBody.circuitBreaker.tripped).toBe(false);

    const briefingRes = await fetch(`http://127.0.0.1:${port}/api/arm/closer/pre-call-briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        leadName: 'Dra. Elena Gómez',
        companyName: 'Clínica Aurora',
        startsInMinutes: 15,
        qualificationScore: 95,
      }),
    });
    expect(briefingRes.status).toBe(200);
    const briefingBody = (await briefingRes.json()) as {
      success: boolean;
      briefing: { startsInMinutes: number; telegramMarkdownPayload: string };
    };
    expect(briefingBody.success).toBe(true);
    expect(briefingBody.briefing.startsInMinutes).toBe(15);
    expect(briefingBody.briefing.telegramMarkdownPayload).toContain('Clínica Aurora');
  });

  it('executes POST /api/arm/tools/execute via the Unified Tool Runner (T8)', async () => {
    const toolRes = await fetch(`http://127.0.0.1:${port}/api/arm/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        toolName: 'transition_pipeline_stage',
        args: {
          to_stage_slug: 'calificado',
          reasoning: 'Score BANT >= 70 confirmado',
        },
      }),
    });
    expect(toolRes.status).toBe(200);
    const toolBody = (await toolRes.json()) as {
      ok: boolean;
      updatedLead: { currentStageSlug: string };
      outboxEventId: number;
    };
    expect(toolBody.ok).toBe(true);
    expect(toolBody.updatedLead.currentStageSlug).toBe('calificado');
    expect(toolBody.outboxEventId).toBeGreaterThan(0);
  });

  it('processes POST /api/arm/closer/post-call, POST /api/arm/antighosting/sweep, and workspace-isolated Meta phone IDs (T9)', async () => {
    const { resolveWorkspacePhoneNumberId } = await import('../meta-outbound-client.js');
    const mockEnv = {
      META_PHONE_NUMBER_ID_B2B: 'phone-b2b-111',
      META_PHONE_NUMBER_ID_P2P: 'phone-p2p-222',
      META_PHONE_NUMBER_ID_360: 'phone-360-333',
    };
    expect(resolveWorkspacePhoneNumberId('ARM_B2B', mockEnv)).toBe('phone-b2b-111');
    expect(resolveWorkspacePhoneNumberId('P2P_DESK', mockEnv)).toBe('phone-p2p-222');
    expect(resolveWorkspacePhoneNumberId('FINANCE_360', mockEnv)).toBe('phone-360-333');

    const postCallRes = await fetch(`http://127.0.0.1:${port}/api/arm/closer/post-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ARM_B2B',
        leadName: 'Carlos (Clínica Aurora)',
        voiceNoteTranscript: 'Le gustó el Plan Enterprise pero quiere pagar en 2 partes 50/50',
      }),
    });
    expect(postCallRes.status).toBe(200);
    const postCallBody = (await postCallRes.json()) as {
      success: boolean;
      processed: { detectedSplitPayment: boolean; recommendedStageSlug: string };
    };
    expect(postCallBody.success).toBe(true);
    expect(postCallBody.processed.detectedSplitPayment).toBe(true);
    expect(postCallBody.processed.recommendedStageSlug).toBe('cotizacion-enviada');

    const sweepRes = await fetch(`http://127.0.0.1:${port}/api/arm/antighosting/sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [
          {
            workspaceId: 'ARM_B2B',
            leadId: 'lead-ghost-1',
            leadName: 'Dr. Méndez',
            lastInboundTimestampMs: Date.now() - 48 * 3600 * 1000,
            followupAttempts: 0,
            painPointMemory: 'citas perdidas',
          },
        ],
      }),
    });
    expect(sweepRes.status).toBe(200);
    const sweepBody = (await sweepRes.json()) as { success: boolean; queuedCount: number };
    expect(sweepBody.success).toBe(true);
    expect(sweepBody.queuedCount).toBe(1);
  });

  it('serves GET /api/arm/health/storage and POST /api/arm/receipts/verify in MEMORY_FALLBACK mode when databaseUrl is omitted', async () => {
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/arm/health/storage`);
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as {
      ok: boolean;
      mode: string;
      postgresConnected: boolean;
      rlsActive: boolean;
    };
    expect(healthBody).toEqual({
      ok: true,
      mode: 'MEMORY_FALLBACK',
      postgresConnected: false,
      rlsActive: false,
    });

    const invalidRes = await fetch(`http://127.0.0.1:${port}/api/arm/receipts/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'P2P_DESK', bankRailId: '', referenceCode: '12', amountFiat: -5 }),
    });
    expect(invalidRes.status).toBe(400);

    const firstRes = await fetch(`http://127.0.0.1:${port}/api/arm/receipts/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'P2P_DESK',
        bankRailId: 'rail-banesco-1',
        referenceCode: 'REF-445566',
        amountFiat: 12500,
        dealId: 'deal-77',
      }),
    });
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      ok: boolean;
      mode: string;
      recorded: boolean;
      collision: boolean;
      normalizedReference: string;
    };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.mode).toBe('MEMORY_FALLBACK');
    expect(firstBody.recorded).toBe(true);
    expect(firstBody.collision).toBe(false);
    expect(firstBody.normalizedReference).toBe('REF445566');

    // Replay with formatting variation collides cleanly
    const replayRes = await fetch(`http://127.0.0.1:${port}/api/arm/receipts/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'P2P_DESK',
        bankRailId: 'rail-banesco-1',
        referenceCode: 'ref 445566',
        amountFiat: 12500,
      }),
    });
    expect(replayRes.status).toBe(409);
    const replayBody = (await replayRes.json()) as {
      ok: boolean;
      recorded: boolean;
      collision: boolean;
      normalizedReference: string;
    };
    expect(replayBody.ok).toBe(false);
    expect(replayBody.recorded).toBe(false);
    expect(replayBody.collision).toBe(true);
    expect(replayBody.normalizedReference).toBe('REF445566');

    // Same reference in another workspace silo is isolated and accepted
    const otherSiloRes = await fetch(`http://127.0.0.1:${port}/api/arm/receipts/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'FINANCE_360',
        bankRailId: 'rail-banesco-1',
        referenceCode: 'REF445566',
        amountFiat: 12500,
      }),
    });
    expect(otherSiloRes.status).toBe(200);
  });
});

describe('Inbound Gateway - PostgreSQL Store Delegation Mode', () => {
  it('delegates storage health, receipt verification, and outbox queries to PgArmStore when configured', async () => {
    const { PgArmStore } = await import('../pg-store.js');
    const mockPgStore = {
      healthCheck: async () => ({
        connected: true,
        latencyMs: 4,
        rlsActive: true,
        pgvectorInstalled: true,
      }),
      recordPaymentReceipt: async () => ({
        recorded: false,
        collision: true,
        normalizedReference: '99881122',
        existingReceiptId: 'pg-rcpt-01',
      }),
      appendOutboxEvent: async (
        workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360',
        eventType: 'pipeline_transition' | 'approval_requested' | 'message_received' | 'agent_run',
        aggregateId: string,
        payload: Record<string, unknown>,
      ) => ({
        id: 501,
        workspaceId,
        eventType,
        aggregateId,
        payload,
        timestamp: 1740000005000,
      }),
      getOutboxEventsSince: async () => [
        {
          id: 501,
          workspaceId: 'ARM_B2B' as const,
          eventType: 'agent_run' as const,
          aggregateId: 'app-501',
          payload: { ok: true },
          timestamp: 1740000005000,
        },
      ],
      startOutboxListener: async () => ({ stop: async () => undefined }),
      close: async () => undefined,
    } as unknown as InstanceType<typeof PgArmStore>;

    const pgServer = new InboundGatewayServer(
      {
        port: 0,
        targetScope: 'P2P_DESK',
        idempotencyTtlSeconds: 60,
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/arm',
      },
      mockPgStore,
    );
    const pgPort = await pgServer.start();

    try {
      const healthRes = await fetch(`http://127.0.0.1:${pgPort}/api/arm/health/storage`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as {
        ok: boolean;
        mode: string;
        postgresConnected: boolean;
        latencyMs: number;
        rlsActive: boolean;
      };
      expect(healthBody).toEqual({
        ok: true,
        mode: 'POSTGRES_PGVECTOR',
        postgresConnected: true,
        latencyMs: 4,
        rlsActive: true,
      });

      const verifyRes = await fetch(`http://127.0.0.1:${pgPort}/api/arm/receipts/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'P2P_DESK',
          bankRailId: 'rail-1',
          referenceCode: '99881122',
          amountFiat: 500,
        }),
      });
      expect(verifyRes.status).toBe(409);
      const verifyBody = (await verifyRes.json()) as {
        mode: string;
        collision: boolean;
        existingReceiptId: string;
      };
      expect(verifyBody.mode).toBe('POSTGRES_PGVECTOR');
      expect(verifyBody.collision).toBe(true);
      expect(verifyBody.existingReceiptId).toBe('pg-rcpt-01');

      const outboxRes = await fetch(`http://127.0.0.1:${pgPort}/api/arm/outbox?sinceId=500&workspaceId=ARM_B2B`);
      expect(outboxRes.status).toBe(200);
      const outboxBody = (await outboxRes.json()) as { count: number; lastEventId: number };
      expect(outboxBody.count).toBe(1);
      expect(outboxBody.lastEventId).toBe(501);
    } finally {
      await pgServer.stop();
    }
  });

  it('returns 503 on GET /api/arm/health/storage when Postgres is disconnected and streams LISTEN/NOTIFY without duplicates', async () => {
    const http = await import('node:http');
    const { PgArmStore } = await import('../pg-store.js');
    type OutboxCallback = (evt: {
      id: number;
      workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360';
      eventType: 'pipeline_transition' | 'approval_requested' | 'message_received' | 'agent_run';
      aggregateId: string;
      payload: Record<string, unknown>;
      timestamp: number;
    }) => void;
    const listenerRef: { cb: OutboxCallback | null } = { cb: null };

    const mockPgStore = {
      healthCheck: async () => ({
        connected: false,
        latencyMs: 12,
        rlsActive: false,
        pgvectorInstalled: false,
        error: 'connection refused',
      }),
      appendOutboxEvent: async (
        workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360',
        eventType: 'pipeline_transition' | 'approval_requested' | 'message_received' | 'agent_run',
        aggregateId: string,
        payload: Record<string, unknown>,
      ) => ({
        id: 800,
        workspaceId,
        eventType,
        aggregateId,
        payload,
        timestamp: 1740000008000,
      }),
      getOutboxEventsSince: async () => [],
      startOutboxListener: async (onEvent: OutboxCallback) => {
        listenerRef.cb = onEvent;
        return { stop: async () => undefined };
      },
      close: async () => undefined,
    } as unknown as InstanceType<typeof PgArmStore>;

    const pgServer = new InboundGatewayServer(
      {
        port: 0,
        targetScope: 'P2P_DESK',
        idempotencyTtlSeconds: 60,
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/arm',
      },
      mockPgStore,
    );
    const pgPort = await pgServer.start();

    const receivedIds: number[] = [];
    const sseReq = http.request(
      `http://127.0.0.1:${pgPort}/api/events`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            if (block.includes('event: arm_event')) {
              const match = block.match(/data: (.*)/);
              if (match?.[1]) {
                const parsed = JSON.parse(match[1]) as { id: number };
                receivedIds.push(parsed.id);
              }
            }
          }
        });
      },
    );
    sseReq.end();

    try {
      await new Promise((r) => setTimeout(r, 50));

      const downRes = await fetch(`http://127.0.0.1:${pgPort}/api/arm/health/storage`);
      expect(downRes.status).toBe(503);
      const downBody = (await downRes.json()) as {
        ok: boolean;
        mode: string;
        postgresConnected: boolean;
      };
      expect(downBody.ok).toBe(false);
      expect(downBody.mode).toBe('POSTGRES_PGVECTOR');
      expect(downBody.postgresConnected).toBe(false);

      // Write through gateway (id 800), then simulate PG NOTIFY echoing id 800 + external id 801
      await fetch(`http://127.0.0.1:${pgPort}/api/arm/approvals/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ARM_B2B', approvalId: 'app-800', decision: 'APPROVED' }),
      });

      listenerRef.cb?.({
        id: 800,
        workspaceId: 'ARM_B2B',
        eventType: 'agent_run',
        aggregateId: 'app-800',
        payload: {},
        timestamp: 1740000008000,
      });
      listenerRef.cb?.({
        id: 801,
        workspaceId: 'P2P_DESK',
        eventType: 'pipeline_transition',
        aggregateId: 'lead-801',
        payload: { stage: 'STAGE_2_TRANSIT' },
        timestamp: 1740000008100,
      });

      for (let i = 0; i < 20; i++) {
        if (receivedIds.length >= 2) break;
        await new Promise((r) => setTimeout(r, 30));
      }

      expect(receivedIds).toEqual([800, 801]);
    } finally {
      sseReq.destroy();
      await pgServer.stop();
    }
  });
});
