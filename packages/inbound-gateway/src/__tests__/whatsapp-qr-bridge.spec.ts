import { describe, it, expect, afterEach } from 'vitest';
import {
  normalizePhoneToJid,
  formatJidToPhone,
  resolveWhatsAppPeerPhone,
  extractBaileysTextContent,
} from '../whatsapp-qr-bridge.js';
import { InboundGatewayServer } from '../server.js';

describe('WhatsApp QR Bridge Helpers & Gateway Routes', () => {
  const servers: InboundGatewayServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      if (s) await s.stop();
    }
  });

  it('normalizes phone numbers to WhatsApp JIDs and formats JIDs back to E.164', () => {
    expect(normalizePhoneToJid('+58 424-7723783')).toBe('584247723783@s.whatsapp.net');
    expect(normalizePhoneToJid('584247723783@s.whatsapp.net')).toBe('584247723783@s.whatsapp.net');
    expect(normalizePhoneToJid('123')).toBeNull();
    expect(formatJidToPhone('584247723783:12@s.whatsapp.net')).toBe('+584247723783');
    expect(formatJidToPhone(null)).toBeNull();
    expect(
      resolveWhatsAppPeerPhone({
        remoteJid: '1492837465@lid',
        remoteJidAlt: '584141234567@s.whatsapp.net',
      }),
    ).toBe('+584141234567');
    expect(
      resolveWhatsAppPeerPhone({
        remoteJid: '1492837465@lid',
        senderPn: '573123701401@s.whatsapp.net',
      }),
    ).toBe('+573123701401');
  });

  it('extracts text and attachment fallbacks from Baileys message envelopes', () => {
    expect(extractBaileysTextContent({ conversation: '  Hola precio USDT  ' })).toEqual({
      text: 'Hola precio USDT',
      mediaType: 'text',
    });

    expect(
      extractBaileysTextContent({
        ephemeralMessage: {
          message: { extendedTextMessage: { text: 'Ref 88441234 Banesco' } },
        },
      }),
    ).toEqual({
      text: 'Ref 88441234 Banesco',
      mediaType: 'text',
    });

    expect(extractBaileysTextContent({ imageMessage: {} })).toEqual({
      text: '[Imagen Adjunta - WhatsApp QR]',
      mediaType: 'image',
    });

    expect(extractBaileysTextContent({ audioMessage: {} })).toEqual({
      text: '[Nota de Voz - WhatsApp QR]',
      mediaType: 'audio',
    });

    expect(extractBaileysTextContent({ documentMessage: { fileName: 'comprobante.pdf' } })).toEqual({
      text: '[Documento: comprobante.pdf]',
      mediaType: 'document',
    });
  });

  it('exposes Bearer-protected GET /api/arm/whatsapp-qr/status on InboundGatewayServer', async () => {
    const server = new InboundGatewayServer({
      port: 0,
      targetScope: 'P2P_DESK',
      idempotencyTtlSeconds: 300,
      authToken: 'test-wa-qr-token',
    });
    servers.push(server);
    const port = await server.start();

    const unauth = await fetch(`http://127.0.0.1:${port}/api/arm/whatsapp-qr/status`);
    expect(unauth.status).toBe(401);

    const okRes = await fetch(`http://127.0.0.1:${port}/api/arm/whatsapp-qr/status`, {
      headers: { Authorization: 'Bearer test-wa-qr-token' },
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { ok: boolean; status: string; qrDataUrl: string | null };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('DISCONNECTED');
    expect(body.qrDataUrl).toBeNull();
  });
});
