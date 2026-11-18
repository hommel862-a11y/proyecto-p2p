import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveWorkspacePhoneNumberId,
  dispatchMetaWhatsappMessage,
  fetchAndAnalyzeMetaMediaWithGemini,
} from '../meta-outbound-client.js';

describe('Meta Outbound & Gemini Flash Multimodal Client', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('dispatches free-window text and HSM templates over Meta Graph API v21.0 strictly by workspace phoneId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test.123' }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const textRes = await dispatchMetaWhatsappMessage({
      workspaceId: 'ARM_B2B',
      recipientPhone: '+584141234567',
      text: 'Propuesta confirmada para Clínica Aurora',
      accessToken: 'meta-token-test',
      phoneNumberId: resolveWorkspacePhoneNumberId('ARM_B2B', {
        META_PHONE_NUMBER_ID_B2B: 'phone-b2b-999',
      }),
    });

    expect(textRes.delivered).toBe(true);
    expect(textRes.mode).toBe('LIVE_META_GRAPH');
    expect(textRes.phoneNumberId).toBe('phone-b2b-999');
    expect(textRes.metaMessageId).toBe('wamid.test.123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/phone-b2b-999/messages',
      expect.objectContaining({ method: 'POST' }),
    );

    const hsmRes = await dispatchMetaWhatsappMessage({
      workspaceId: 'FINANCE_360',
      recipientPhone: '+584141112233',
      text: '',
      templateName: 'arm_contextual_followup_v1',
      templateVariables: ['Ana Pérez', 'pago 50/50'],
      accessToken: 'meta-token-test',
      phoneNumberId: 'phone-360-777',
    });

    expect(hsmRes.delivered).toBe(true);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const sentBody = JSON.parse(String(secondCallInit.body)) as {
      type: string;
      template: { name: string };
    };
    expect(sentBody.type).toBe('template');
    expect(sentBody.template.name).toBe('arm_contextual_followup_v1');
  });

  it('handles Meta API error status gracefully without throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Invalid OAuth access token',
    }) as unknown as typeof fetch;

    const errRes = await dispatchMetaWhatsappMessage({
      workspaceId: 'P2P_DESK',
      recipientPhone: '+584149998877',
      text: 'Test',
      accessToken: 'bad-token',
      phoneNumberId: 'phone-p2p-111',
    });

    expect(errRes.delivered).toBe(false);
    expect(errRes.mode).toBe('META_API_ERROR');
    expect(errRes.error).toContain('403');
  });

  it('downloads Meta media binary and transcribes/extracts via Gemini Flash multimodal', async () => {
    const fetchMock = vi
      .fn()
      // 1. Lookup Meta media metadata URL
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=999',
          mime_type: 'audio/ogg',
        }),
      })
      // 2. Download media binary bytes
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      })
      // 3. Gemini Flash generateContent transcription
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hola, somos 20 médicos y queremos cotización anual con descuento.' }],
              },
            },
          ],
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mediaRes = await fetchAndAnalyzeMetaMediaWithGemini({
      mediaId: 'media-voice-999',
      mediaType: 'voice',
      mimeType: 'audio/ogg',
      accessToken: 'meta-token',
      geminiApiKey: 'gemini-key',
    });

    expect(mediaRes.analyzed).toBe(true);
    expect(mediaRes.mode).toBe('GEMINI_VISION_AUDIO');
    expect(mediaRes.extractedText).toContain('20 médicos');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
