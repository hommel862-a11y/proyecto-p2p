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
        image?: { caption?: string; id?: string };
        document?: { caption?: string; filename?: string };
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
          if (msg.type === 'text' && msg.text?.body) {
            text = msg.text.body;
          } else if (msg.type === 'image' && msg.image?.caption) {
            text = msg.image.caption;
          } else if (msg.type === 'document' && msg.document?.caption) {
            text = msg.document.caption;
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
