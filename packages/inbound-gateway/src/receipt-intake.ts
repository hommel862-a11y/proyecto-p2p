import {
  parseBankSmsClipboard,
  normalizeBankReference,
  type WorkspaceScope,
  type PipelineDeal,
  verifyReferenceCollision,
} from '@p2p/core';
import type { InboundNormalizedMessage, InboundReceiptEvent } from './types.js';

/**
 * Transforms an incoming normalized message into a structured receipt event using @p2p/core pure parsers.
 */
export function processInboundMessageToReceipt(
  message: InboundNormalizedMessage,
  scope: WorkspaceScope = 'P2P_DESK',
  existingDeals: PipelineDeal[] = [],
): InboundReceiptEvent | null {
  const parsed = parseBankSmsClipboard(message.text);

  // A message is considered a potential bank receipt if it has either a reference or an amount
  const hasFinancialData = Boolean(parsed.referenceId || (parsed.amountFiat && parsed.amountFiat > 0));
  if (!hasFinancialData) {
    return null;
  }

  let status: 'PENDING_REVIEW' | 'AUTO_MATCHED' | 'DUPLICATE_FLAGGED' = 'PENDING_REVIEW';

  if (parsed.referenceId) {
    const collision = verifyReferenceCollision(existingDeals, parsed.referenceId);
    if (collision.isDuplicate) {
      status = 'DUPLICATE_FLAGGED';
    } else {
      status = 'AUTO_MATCHED';
    }
  }

  return {
    eventId: message.eventId,
    channel: message.channel,
    sender: message.sender,
    parsed,
    scope,
    receivedAt: message.timestamp,
    rawText: message.text,
    status,
  };
}
