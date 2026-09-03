import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService } from '../../core/storage';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { CounterpartyService } from '../../core/counterparty.service';
import { fmtVes, fmtUsd } from '../../core/format';
import {
  computeStats,
  aggregateSessions,
  generateComplianceStatement,
  type Operation,
  type PeriodKind,
  type PeriodStat,
  type SessionSummary,
  type ComplianceReportMetadata,
  type ComplianceStatement,
} from '@p2p/core';

const OPS_KEY = 'p2p.operations';

export type ExtendedPeriodKind = PeriodKind | 'session';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stats.html',
})
export class Stats {
  private readonly storage = inject(StorageService);
  private readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly crmService = inject(CounterpartyService);

  readonly period = signal<ExtendedPeriodKind>('day');
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>('all');

  /** Compliance statement generation state */
  readonly showComplianceModal = signal<boolean>(false);
  readonly complianceMeta = signal<ComplianceReportMetadata>({
    operatorName: 'Operador P2P Independiente',
    documentId: 'V-00.000.000',
    economicActivity: 'Intercambio y corretaje de criptoactivos en plataforma P2P',
    targetBank: 'Banesco Banco Universal',
    targetAccountNumber: '',
  });
  readonly complianceStartDate = signal<string>('');
  readonly complianceEndDate = signal<string>('');

  readonly complianceStatement = computed<ComplianceStatement>(() => {
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const accounts = this.accountsService.accounts();
    const counterparties = this.crmService.counterparties();
    return generateComplianceStatement(ops, accounts, counterparties, this.complianceMeta(), {
      startDate: this.complianceStartDate() || undefined,
      endDate: this.complianceEndDate() || undefined,
    });
  });

  private readonly summary = computed(() =>
    computeStats(this.storage.get<Operation[]>(OPS_KEY) ?? [], this.pairFilter()),
  );

  readonly rows = computed<PeriodStat[]>(() => {
    const s = this.summary();
    if (this.period() === 'day') return s.daily;
    if (this.period() === 'month') return s.monthly;
    return s.quarterly;
  });

  readonly totals = computed(() => {
    const d = this.summary().daily;
    return {
      operations: d.reduce((a, p) => a + p.operations, 0),
      pnlVes: d.reduce((a, p) => a + p.pnlVes, 0),
      volumeUsdt: d.reduce((a, p) => a + p.volumeUsdt, 0),
      fees: d.reduce((a, p) => a + p.fees, 0),
    };
  });

  readonly sessionSummaries = computed<SessionSummary[]>(() => {
    const sessions = this.sessionService.sessions();
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    return aggregateSessions(sessions, ops);
  });

  setPeriod(p: ExtendedPeriodKind): void {
    this.period.set(p);
  }

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '0m';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  formatRating(stars?: number): string {
    if (!stars || stars <= 0) return '—';
    return '⭐'.repeat(Math.min(5, Math.max(1, stars)));
  }

  patchComplianceMeta(partial: Partial<ComplianceReportMetadata>): void {
    this.complianceMeta.update((curr) => ({ ...curr, ...partial }));
  }

  openComplianceModal(): void {
    this.showComplianceModal.set(true);
  }

  closeComplianceModal(): void {
    this.showComplianceModal.set(false);
  }

  printComplianceReport(): void {
    window.print();
  }

  // Shared es-VE money formatters (byte-identical to the `ves`/`usdt` pipes).
  readonly fmtVes = fmtVes;
  readonly fmtUsd = fmtUsd;
  // Whole-number counts render without forced decimals — es-VE formatting kept identical.
  readonly fmtNum = (v: number): string => v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
