import { AddOperationEntryInputSchema, type AddOperationEntryInput } from '../schemas/index.js';
import { confirmationManager } from '../policy/permissions.js';

export interface InMemoryOperation {
  id: string;
  timestamp: string;
  side: 'buy' | 'sell';
  vesAmount: number;
  usdtAmount: number;
  price: number;
  notes?: string;
  counterpartyName?: string;
}

const inMemoryLedger: InMemoryOperation[] = [];

export function getInMemoryLedger(): InMemoryOperation[] {
  return inMemoryLedger;
}

export const addOperationEntryTool = {
  name: 'add_operation_entry',
  description: 'Asienta una nueva operación en el Ledger. Requiere confirmación humana explícita.',
  inputSchema: AddOperationEntryInputSchema,
  execute: (input: AddOperationEntryInput) => {
    if (!input.humanConfirm) {
      const challengeToken = confirmationManager.generateChallengeToken('add_operation_entry', {
        side: input.side,
        vesAmount: input.vesAmount,
        usdtAmount: input.usdtAmount,
        price: input.price,
      });

      return {
        recorded: false,
        requiresHumanConfirmation: true,
        challengeToken,
        message: 'Acción de escritura en Ledger protegida. Reenvía con humanConfirm: true y el challengeToken.',
      };
    }

    const orderId = `ORD-MCP-${Date.now().toString(36).toUpperCase()}`;
    const entry: InMemoryOperation = {
      id: orderId,
      timestamp: new Date().toISOString(),
      side: input.side,
      vesAmount: input.vesAmount,
      usdtAmount: input.usdtAmount,
      price: input.price,
      notes: input.notes,
      counterpartyName: input.counterpartyName,
    };

    inMemoryLedger.unshift(entry);

    return {
      recorded: true,
      orderId,
      entry,
      ledgerLength: inMemoryLedger.length,
    };
  },
};
