import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLoggerService } from './audit-logger.service';
import { P2P_STORAGE } from './storage';
import { MemoryStorage } from './memory-storage';

describe('AuditLoggerService', () => {
  let service: AuditLoggerService;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [AuditLoggerService, { provide: P2P_STORAGE, useValue: mem }],
    });
    service = TestBed.inject(AuditLoggerService);
  });

  it('records audit events with timestamps, categories and details', () => {
    service.log('CONFIG_CHANGE', 'Reglas actualizadas', { minSpread: 20 }, 'info');
    expect(service.events().length).toBe(1);
    const event = service.events()[0];
    expect(event.category).toBe('CONFIG_CHANGE');
    expect(event.action).toBe('Reglas actualizadas');
    expect(event.severity).toBe('info');
    expect(event.timestamp).toBeDefined();
  });

  it('persists audit events and loads them from storage', () => {
    service.log('DATA_MUTATION', 'Operación registrada');
    expect(service.events().length).toBe(1);

    // Re-inject reads from the same MemoryStorage backend
    const service2 = TestBed.inject(AuditLoggerService);
    expect(service2.events().length).toBe(1);
  });

  it('exports audit log to valid JSON formatted string', () => {
    service.log('DATA_BACKUP', 'Respaldo exportado');
    const json = service.exportAuditLog();
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('p2p-decisor');
    expect(parsed.type).toBe('audit-log');
    expect(parsed.totalEvents).toBe(1);
    expect(parsed.events.length).toBe(1);
  });

  it('clear() empties the audit event log', () => {
    service.log('SECURITY_ALERT', 'Alerta de riesgo');
    expect(service.events().length).toBe(1);
    service.clear();
    expect(service.events().length).toBe(0);
  });
});
