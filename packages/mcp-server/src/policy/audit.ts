import { computeSha256 } from '../core/index.js';

export interface McpAuditEntry {
  id: string;
  toolName: string;
  inputHash: string;
  outputHash: string;
  clientId: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

export class McpAuditService {
  private readonly memoryTrail: McpAuditEntry[] = [];

  record(entry: {
    toolName: string;
    input: unknown;
    output: unknown;
    clientId?: string;
    success?: boolean;
    error?: string;
  }): McpAuditEntry {
    const inputHash = computeSha256(JSON.stringify(entry.input ?? null));
    const outputHash = computeSha256(JSON.stringify(entry.output ?? null));

    const auditRecord: McpAuditEntry = {
      id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      toolName: entry.toolName,
      inputHash,
      outputHash,
      clientId: entry.clientId || 'default-agent',
      timestamp: Date.now(),
      success: entry.success ?? true,
      error: entry.error,
    };

    this.memoryTrail.unshift(auditRecord);
    if (this.memoryTrail.length > 500) {
      this.memoryTrail.pop();
    }

    return auditRecord;
  }

  getRecentAuditEntries(limit = 50): McpAuditEntry[] {
    return this.memoryTrail.slice(0, limit);
  }
}

export const auditService = new McpAuditService();
