import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { InboundGatewayServer } from '../server.js';
import {
  verifyReferenceCollision,
  type PipelineDeal,
  type InboundReceiptEvent,
  type WorkspaceScope,
} from '@p2p/core';

describe('Inbound to Kanban Pipeline - E2E Integration Flow', () => {
  let server: InboundGatewayServer;
  let port: number;
  const appSecret = 'desk-master-secret-key-999';
  const verifyToken = 'desk-verify-token';

  beforeEach(async () => {
    server = new InboundGatewayServer({
      port: 0,
      metaAppSecret: appSecret,
      metaVerifyToken: verifyToken,
      targetScope: 'P2P_DESK',
      idempotencyTtlSeconds: 300,
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('transfers an incoming WhatsApp Pago Móvil receipt into a validated CRM deal in STAGE_1_NEW via SSE', async () => {
    // 1. Establish SSE stream listener representing Angular InboundGatewayService
    const receivedSseEvents: InboundReceiptEvent[] = [];

    const sseReq = http.request(
      `http://127.0.0.1:${port}/api/events`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const block of lines) {
            if (block.includes('event: new_receipt')) {
              const dataMatch = block.match(/data: (.*)/);
              if (dataMatch && dataMatch[1]) {
                try {
                  receivedSseEvents.push(JSON.parse(dataMatch[1]));
                } catch {
                  // ignore
                }
              }
            }
          }
        });
      },
    );
    sseReq.end();

    // Give SSE connection 50ms to register in server
    await new Promise((r) => setTimeout(r, 50));

    // 2. Dispatch simulated WhatsApp Business webhook payload
    const receiptSms = 'BANESCO: Pago Movil recibido de Alejandro Magno CI 19888777 por Bs. 82.000,00 Ref: 55443322';
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_DESK_OPERATIONS',
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ profile: { name: 'Alejandro Magno' }, wa_id: '584120001122' }],
                messages: [
                  {
                    from: '584120001122',
                    id: 'wamid.HBgNNTg0MTIwMDAxMTIyFQIAERgSQURFRTM',
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: 'text',
                    text: { body: receiptSms },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const hmacSig = `sha256=${createHmac('sha256', appSecret).update(payload).digest('hex')}`;

    const webhookRes = await fetch(`http://127.0.0.1:${port}/webhook/meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': hmacSig,
      },
      body: payload,
    });

    expect(webhookRes.status).toBe(200);
    const result = await webhookRes.json();
    expect(result.success).toBe(true);
    expect(result.newReceiptsDetected).toBe(1);

    // 3. Wait for SSE event arrival
    for (let i = 0; i < 20; i++) {
      if (receivedSseEvents.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(receivedSseEvents.length).toBe(1);
    const sseReceipt = receivedSseEvents[0];

    expect(sseReceipt.channel).toBe('WHATSAPP');
    expect(sseReceipt.sender.id).toBe('584120001122');
    expect(sseReceipt.sender.name).toBe('Alejandro Magno');
    expect(sseReceipt.parsed.referenceId).toBe('55443322');
    expect(sseReceipt.parsed.amountFiat).toBe(82000);
    expect(sseReceipt.parsed.detectedBank).toBe('Banesco');
    expect(sseReceipt.status).toBe('AUTO_MATCHED');

    // 4. Simulate Angular Cockpit deal generation
    const liveReplacementRate = 82.0; // 82 Bs per USDT
    const existingDeals: PipelineDeal[] = [];

    // Check collision
    const collision = verifyReferenceCollision(existingDeals, sseReceipt.parsed.referenceId!);
    expect(collision.isDuplicate).toBe(false);

    const cryptoAmountUsdt = Math.round((sseReceipt.parsed.amountFiat! / liveReplacementRate) * 100) / 100;
    expect(cryptoAmountUsdt).toBe(1000); // 82,000 / 82 = 1,000 USDT

    const createdDeal: PipelineDeal = {
      id: `INB-${sseReceipt.eventId.slice(-6)}`,
      scope: 'P2P_DESK',
      title: `Ingreso WHATSAPP: ${sseReceipt.sender.name}`,
      contactId: 'CNT-ALEJANDRO',
      contactName: sseReceipt.sender.name!,
      bankAccountId: 'BNK-BANESCO-01',
      bankName: sseReceipt.parsed.detectedBank!,
      stage: 'STAGE_1_NEW',
      fiatCurrency: 'VES',
      cryptoAmountUsdt,
      appliedRate: liveReplacementRate,
      replacementRate: liveReplacementRate,
      totalFiatAmount: sseReceipt.parsed.amountFiat!,
      paidFiatAmount: 0,
      netProfitUsdt: 0,
      bankReferenceId: sseReceipt.parsed.referenceId!,
      quoteTtlMinutes: 15,
      quotedAt: Date.now(),
      isRateExpired: false,
      timeline: [
        {
          timestamp: Date.now(),
          fromStage: null,
          toStage: 'STAGE_1_NEW',
          notes: `Ingreso automático vía WHATSAPP Ref: ${sseReceipt.parsed.referenceId}`,
        },
      ],
      createdAt: Date.now(),
      closedAt: null,
    };

    existingDeals.push(createdDeal);

    expect(createdDeal.stage).toBe('STAGE_1_NEW');
    expect(createdDeal.cryptoAmountUsdt).toBe(1000);
    expect(createdDeal.totalFiatAmount).toBe(82000);
    expect(createdDeal.bankReferenceId).toBe('55443322');

    // 5. Test collision: second attempt with same reference is rejected
    const secondCollision = verifyReferenceCollision(existingDeals, '55443322');
    expect(secondCollision.isDuplicate).toBe(true);
    expect(secondCollision.existingDeal?.id).toBe(createdDeal.id);

    // Clean up SSE client socket
    sseReq.destroy();
  });
});
