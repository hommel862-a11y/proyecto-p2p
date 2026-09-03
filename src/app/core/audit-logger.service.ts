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
const MAX_AUDIT_ENTRIES = 200;

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

    const updated = [event, ...this.events()].slice(0, MAX_AUDIT_ENTRIES);
    this.events.set(updated);

    try {
      this.storage.set(AUDIT_STORAGE_KEY, updated);
    } catch {
      // Degradación silenciosa si el almacenamiento está lleno
    }
  }

  exportAuditLog(): string {
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

  clear(): void {
    this.events.set([]);
    this.storage.remove(AUDIT_STORAGE_KEY);
  }
}
