import type { WorkspaceScope, ClipboardParseResult } from './client-compliance-intelligence';

export type InboundChannel = 'WHATSAPP' | 'INSTAGRAM' | 'GMAIL' | 'MANUAL_WEBHOOK';

export interface InboundSender {
  id: string;
  name?: string;
  channel: InboundChannel;
}

export interface InboundNormalizedMessage {
  eventId: string;
  channel: InboundChannel;
  sender: InboundSender;
  text: string;
  timestamp: number;
  mediaUrl?: string;
  rawPayloadId?: string;
}

export interface InboundReceiptEvent {
  eventId: string;
  channel: InboundChannel;
  sender: InboundSender;
  parsed: ClipboardParseResult;
  scope: WorkspaceScope;
  receivedAt: number;
  rawText: string;
  status: 'PENDING_REVIEW' | 'AUTO_MATCHED' | 'DUPLICATE_FLAGGED';
}
