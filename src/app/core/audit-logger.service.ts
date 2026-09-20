import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';

export type AuditCategory =
  | 'CONFIG_CHANGE'
  | 'SECURITY_ALERT'
  | 'DATA_BACKUP'
  | 'DATA_RESTORE'
  | 'DATA_MUTATION'
  | 'SYSTEM_ERROR';

export type AuditSeverity = 'info' | 'warn' | 'error';

export interface AuditEvent {
  id: string;
  timestamp: string;
  category: AuditCategory;
  action: string;
  details?: Record<string, unknown> | string;
  severity: AuditSeverity;
}

const AUDIT_STORAGE_KEY = 'p2p.audit-log';
export const MAX_IN_MEMORY_ENTRIES = 5000;

@Injectable({ providedIn: 'root' })
export class AuditLoggerService {
  private readonly storage = inject(StorageService);

  readonly events = signal<AuditEvent[]>(this.load());

  private load(): AuditEvent[] {
    try {
      return this.storage.get<AuditEvent[]>(AUDIT_STORAGE_KEY) ?? [];
    } catch {
      return [];
    }
  }

  log(
    category: AuditCategory,
    action: string,
    details?: Record<string, unknown> | string,
    severity: AuditSeverity = 'info',
  ): void {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      action,
      details,
      severity,
    };

    const updated = [event, ...this.events()].slice(0, MAX_IN_MEMORY_ENTRIES);
    this.events.set(updated);

    try {
      this.storage.set(AUDIT_STORAGE_KEY, updated);
    } catch {
      // Degradación silenciosa si el almacenamiento web está saturado
    }

    // Dual-write to Electron SQLite relacional si estamos en entorno desktop
    if (typeof window !== 'undefined') {
      const electronApi = (
        window as unknown as {
          electron?: {
            db?: {
              saveAuditLog: (record: {
                id: string;
                timestamp: string;
                category: string;
                action: string;
                details?: string;
                severity: string;
                createdAt: number;
              }) => Promise<boolean>;
            };
          };
        }
      )?.electron;

      if (electronApi?.db?.saveAuditLog) {
        void electronApi.db
          .saveAuditLog({
            id: event.id,
            timestamp: event.timestamp,
            category: event.category,
            action: event.action,
            details: typeof event.details === 'object' ? JSON.stringify(event.details) : event.details,
            severity: event.severity,
            createdAt: Date.now(),
          })
          .catch((err) => console.warn('[AuditLogger] SQLite IPC save warning:', err));
      }
    }
  }

  exportAuditLog(): string {
    return this.exportAuditLogsJson();
  }

  exportAuditLogsJson(): string {
    return JSON.stringify(
      {
        app: 'p2p-decisor',
        type: 'audit-log',
        version: 1,
        exportedAt: new Date().toISOString(),
        totalEvents: this.events().length,
        events: this.events(),
      },
      null,
      2,
    );
  }

  exportAuditLogsCsv(): string {
    const headers = ['id', 'timestamp', 'category', 'action', 'severity', 'details'];
    const rows = this.events().map((e) => {
      const detailStr = typeof e.details === 'object' ? JSON.stringify(e.details) : (e.details ?? '');
      const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
      return [
        escapeCsv(e.id),
        escapeCsv(e.timestamp),
        escapeCsv(e.category),
        escapeCsv(e.action),
        escapeCsv(e.severity),
        escapeCsv(detailStr),
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\r\n');
  }

  clearArchived(olderThanDays = 30): { purgedCount: number; remainingCount: number } {
    const cutoffMs = Date.now() - olderThanDays * 86_400_000;
    const current = this.events();
    const kept = current.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return isNaN(t) || t >= cutoffMs;
    });

    const purgedCount = current.length - kept.length;
    this.events.set(kept);

    try {
      this.storage.set(AUDIT_STORAGE_KEY, kept);
    } catch {
      // ignore
    }

    return { purgedCount, remainingCount: kept.length };
  }

  clear(): void {
    this.events.set([]);
    this.storage.remove(AUDIT_STORAGE_KEY);
  }
}
