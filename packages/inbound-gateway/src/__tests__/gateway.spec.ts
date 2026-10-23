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
});
