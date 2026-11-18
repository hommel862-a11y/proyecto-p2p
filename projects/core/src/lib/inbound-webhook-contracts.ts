import type { WorkspaceScope, ClipboardParseResult } from './client-compliance-intelligence';
import type { ArmWorkspaceId } from './arm-orchestration-engine';

export type InboundChannel = 'WHATSAPP' | 'INSTAGRAM' | 'GMAIL' | 'MANUAL_WEBHOOK';

export type InboundMediaType = 'text' | 'image' | 'audio' | 'voice' | 'document';

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
  mediaId?: string;
  mediaMimeType?: string;
  mediaType?: InboundMediaType;
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

export type ArmOutboxEventType =
  | 'pipeline_transition'
  | 'approval_requested'
  | 'message_received'
  | 'agent_run';

export interface ArmOutboxSseEvent {
  id: number;
  workspaceId: ArmWorkspaceId;
  eventType: ArmOutboxEventType;
  aggregateId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}
