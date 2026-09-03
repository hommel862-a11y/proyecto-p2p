import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';
import { type Counterparty, type CounterpartyReputation, normalizeName } from '@p2p/core';

const CRM_STORAGE_KEY = 'p2p.counterparties';

const DEFAULT_COUNTERPARTIES: Counterparty[] = [
  {
    id: 'cp-1',
    alias: 'CriptoVzla_VIP',
    realName: 'Juan Carlos Pérez González',
    documentId: 'V-18452123',
    phone: '0414-1234567',
    bankAccounts: ['Banesco', 'Pago Móvil'],
    reputation: 'TRUSTED',
    notes: 'Comerciante verificado. Siempre transfiere desde cuenta bancaria propia.',
    createdAt: '2026-01-15',
  },
  {
    id: 'cp-2',
    alias: 'CaracasExchange_Pro',
    realName: 'María Alejandra Rodríguez',
    documentId: 'V-21334556',
    phone: '0412-9876543',
    bankAccounts: ['Mercantil', 'BDV'],
    reputation: 'VERIFIED',
    notes: 'Pagos rápidos y puntuales.',
    createdAt: '2026-02-10',
  },
  {
    id: 'cp-3',
    alias: 'Estafador_Reportado',
    realName: 'Carlos Fraude Alerta',
    documentId: 'V-19888999',
    reputation: 'BLOCKED',
    notes: 'BLOQUEADO: Intentó pagar con cuenta de un tercero (Triangulación detectada).',
    createdAt: '2026-02-28',
  },
];

@Injectable({ providedIn: 'root' })
export class CounterpartyService {
  private readonly storage = inject(StorageService);
  private readonly audit = inject(AuditLoggerService);

  readonly counterparties = signal<Counterparty[]>(this.loadCounterparties());

  getById(id: string): Counterparty | undefined {
    return this.counterparties().find((c) => c.id === id);
  }

  findByQuery(query: string): Counterparty | undefined {
    const q = normalizeName(query);
    if (!q) return undefined;
    return this.counterparties().find(
      (c) =>
        normalizeName(c.alias) === q ||
        normalizeName(c.realName) === q ||
        c.documentId.toLowerCase() === query.toLowerCase().trim(),
    );
  }

  addCounterparty(cp: Omit<Counterparty, 'id' | 'createdAt'>): Counterparty {
    const created: Counterparty = {
      ...cp,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const next = [...this.counterparties(), created];
    this.save(next);
    this.audit.log(
      'CONFIG_CHANGE',
      'Contraparte agregada al CRM',
      { id: created.id, alias: created.alias },
      'info',
    );
    return created;
  }

  updateCounterparty(updated: Counterparty): void {
    const next = this.counterparties().map((c) => (c.id === updated.id ? updated : c));
    this.save(next);
    this.audit.log(
      'CONFIG_CHANGE',
      'Contraparte actualizada en el CRM',
      { id: updated.id, alias: updated.alias },
      'info',
    );
  }

  deleteCounterparty(id: string): void {
    const next = this.counterparties().filter((c) => c.id !== id);
    this.save(next);
    this.audit.log('CONFIG_CHANGE', 'Contraparte eliminada del CRM', { id }, 'info');
  }

  private save(list: Counterparty[]): void {
    try {
      this.storage.set(CRM_STORAGE_KEY, list);
    } catch {
      // Non-blocking in case of storage quota failure
    }
    this.counterparties.set(list);
  }

  private loadCounterparties(): Counterparty[] {
    try {
      const stored = this.storage.get<Counterparty[]>(CRM_STORAGE_KEY);
      if (Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
      this.storage.set(CRM_STORAGE_KEY, DEFAULT_COUNTERPARTIES);
      return DEFAULT_COUNTERPARTIES;
    } catch {
      return DEFAULT_COUNTERPARTIES;
    }
  }
}
