import type { InboundNormalizedMessage } from './types.js';

interface MetaWebhookEntry {
  id?: string;
  time?: number;
  changes?: Array<{
    field?: string;
    value?: {
      messaging_product?: string;
      metadata?: { display_phone_number?: string; phone_number_id?: string };
      contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
      messages?: Array<{
        from?: string;
        id?: string;
        timestamp?: string | number;
        type?: string;
        text?: { body?: string };
        image?: { caption?: string; id?: string; mime_type?: string };
        audio?: { id?: string; mime_type?: string; voice?: boolean };
        voice?: { id?: string; mime_type?: string };
        document?: { caption?: string; filename?: string; id?: string; mime_type?: string };
      }>;
    };
  }>;
  // Instagram messaging shape
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      attachments?: Array<{
        type?: string;
        payload?: { url?: string };
      }>;
    };
  }>;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

/**
 * Parses raw JSON payload from Meta Webhooks (WhatsApp Business & Instagram).
 * Returns an array of normalized incoming messages.
 */
export function parseMetaWebhookPayload(rawPayload: unknown): InboundNormalizedMessage[] {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return [];
  }

  const payload = rawPayload as MetaWebhookPayload;
  const objectType = payload.object;
  const entries = payload.entry;

  if (!Array.isArray(entries)) {
    return [];
  }

  const results: InboundNormalizedMessage[] = [];

  for (const entry of entries) {
    // 1. WhatsApp Business Webhook Format
    if (objectType === 'whatsapp_business_account' || entry.changes) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        const val = change.value;
        if (!val || !val.messages) continue;

        const contactNameMap = new Map<string, string>();
        if (Array.isArray(val.contacts)) {
          for (const c of val.contacts) {
            if (c.wa_id && c.profile?.name) {
              contactNameMap.set(c.wa_id, c.profile.name);
            }
          }
        }

        for (const msg of val.messages) {
          const from = msg.from ?? 'UNKNOWN_SENDER';
          const senderName = contactNameMap.get(from) || from;
          const msgId = msg.id || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const timestamp = typeof msg.timestamp === 'string'
            ? parseInt(msg.timestamp, 10) * 1000
            : (typeof msg.timestamp === 'number' ? msg.timestamp * 1000 : Date.now());

          let text = '';
          let mediaId: string | undefined;
          let mediaMimeType: string | undefined;
          let mediaType: 'text' | 'image' | 'audio' | 'voice' | 'document' = 'text';

          if (msg.type === 'text' && msg.text?.body) {
            text = msg.text.body;
            mediaType = 'text';
          } else if (msg.type === 'image') {
            mediaId = msg.image?.id;
            mediaMimeType = msg.image?.mime_type;
            mediaType = 'image';
            text = msg.image?.caption?.trim() || '[Imagen Adjunta]';
          } else if (msg.type === 'audio' || msg.type === 'voice') {
            mediaId = msg.audio?.id || msg.voice?.id;
            mediaMimeType = msg.audio?.mime_type || msg.voice?.mime_type;
            mediaType = msg.audio?.voice || msg.type === 'voice' ? 'voice' : 'audio';
            text = '[Nota de Voz]';
          } else if (msg.type === 'document') {
            mediaId = msg.document?.id;
            mediaMimeType = msg.document?.mime_type;
            mediaType = 'document';
            text =
              msg.document?.caption?.trim() ||
              (msg.document?.filename ? `[Documento Adjunto: ${msg.document.filename}]` : '[Documento Adjunto]');
          }

          if (text.trim().length > 0) {
            results.push({
              eventId: msgId,
              channel: 'WHATSAPP',
              sender: {
                id: from,
                name: senderName,
                channel: 'WHATSAPP',
              },
              text: text.trim(),
              timestamp,
              mediaId,
              mediaMimeType,
              mediaType,
              rawPayloadId: msgId,
            });
          }
        }
      }
    }

    // 2. Instagram Messaging Webhook Format
    if (objectType === 'instagram' || entry.messaging) {
      const messages = entry.messaging ?? [];
      for (const item of messages) {
        const msg = item.message;
        if (!msg) continue;

        const senderId = item.sender?.id ?? 'UNKNOWN_IG_USER';
        const msgId = msg.mid || `ig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const timestamp = item.timestamp ?? Date.now();
        const text = msg.text ?? '';

        if (text.trim().length > 0) {
          results.push({
            eventId: msgId,
            channel: 'INSTAGRAM',
            sender: {
              id: senderId,
              name: `IG User ${senderId.slice(-4)}`,
              channel: 'INSTAGRAM',
            },
            text: text.trim(),
            timestamp,
            rawPayloadId: msgId,
          });
        }
      }
    }
  }

  return results;
}
