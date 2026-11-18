import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  ActivityLogEntry,
  ArmWorkspaceId,
  CrmStorageHealthTelemetry,
} from '../../crm-ui.models';

export const AUDIT_IMPORT_STRATEGY = {
  MERGE: 'MERGE',
  REPLACE: 'REPLACE',
} as const;

export type AuditImportStrategy =
  (typeof AUDIT_IMPORT_STRATEGY)[keyof typeof AUDIT_IMPORT_STRATEGY];

export const AUDIT_CSV_TARGET = {
  CONTACTS: 'CONTACTS',
  BANKS: 'BANKS',
  ACTIVITIES: 'ACTIVITIES',
} as const;

export type AuditCsvTarget =
  (typeof AUDIT_CSV_TARGET)[keyof typeof AUDIT_CSV_TARGET];

export interface ParsedSmsPreview {
  bank?: string;
  reference?: string;
  amount?: number;
  confidence?: number;
}

export interface RefVerifyResult {
  checked: boolean;
  isUnique: boolean;
  message: string;
}

const DEFAULT_STORAGE_HEALTH: CrmStorageHealthTelemetry = {
  postgresStatus: 'LOCAL_FALLBACK',
  postgresDetail: 'Local-first SQLite activo',
  sqliteStatus: 'SYNCED',
  sqliteDetail: 'Espejo SQLite listo',
  gatewayStatus: 'DISCONNECTED',
  gatewayDetail: 'Gateway en espera',
  dailyBudgetUsedUsd: 0,
  dailyBudgetCapUsd: 10,
};

const LED_SEGMENTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const SILO_OPTIONS: readonly { id: ArmWorkspaceId; label: string }[] = [
  { id: 'ARM_B2B', label: 'ARM B2B' },
  { id: 'P2P_DESK', label: 'Mesa P2P' },
  { id: 'FINANCE_360', label: 'Finanzas 360' },
];

@Component({
  selector: 'app-crm-audit-system',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './crm-audit-system.component.html',
  styleUrl: './crm-audit-system.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
  },
})
export class CrmAuditSystemComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly activities = input<ActivityLogEntry[]>([]);
  readonly storageHealth = input<CrmStorageHealthTelemetry>(DEFAULT_STORAGE_HEALTH);
  readonly smsInput = input<string>('');
  readonly parsedSmsPreview = input<ParsedSmsPreview | null>(null);
  readonly refVerifyInput = input<string>('');
  readonly refVerifyResult = input<RefVerifyResult | null>(null);
  readonly auditSearch = input<string>('');
  readonly auditTypeFilter = input<string>('ALL');
  readonly liveReplacementRate = input<number>(82);
  readonly importStrategy = input<AuditImportStrategy>('MERGE');
  readonly csvTarget = input<AuditCsvTarget>('CONTACTS');

  readonly smsInputChange = output<string>();
  readonly extractSms = output<void>();
  readonly refVerifyInputChange = output<string>();
  readonly verifyReference = output<void>();
  readonly auditSearchChange = output<string>();
  readonly auditTypeFilterChange = output<string>();
  readonly siloChange = output<ArmWorkspaceId>();
  readonly replacementRateChange = output<number>();
  readonly importStrategyChange = output<AuditImportStrategy>();
  readonly csvTargetChange = output<AuditCsvTarget>();
  readonly exportJson = output<void>();
  readonly exportCsv = output<void>();
  readonly importJsonFile = output<File>();
  readonly importCsvFile = output<File>();

  readonly ledSegments = LED_SEGMENTS;
  readonly siloOptions = SILO_OPTIONS;

  readonly filteredActivities = computed<ActivityLogEntry[]>(() => {
    const query = this.auditSearch().trim().toLowerCase();
    const typeFilter = this.auditTypeFilter();
    return this.activities().filter((act) => {
      if (typeFilter !== 'ALL' && act.type !== typeFilter) return false;
      if (!query) return true;
      return (
        act.description.toLowerCase().includes(query) ||
        act.type.toLowerCase().includes(query) ||
        (act.referenceId ? act.referenceId.toLowerCase().includes(query) : false)
      );
    });
  });

  readonly budgetRatioPct = computed<number>(() => {
    const health = this.storageHealth();
    if (!health.dailyBudgetCapUsd || health.dailyBudgetCapUsd <= 0) return 0;
    const raw = (health.dailyBudgetUsedUsd / health.dailyBudgetCapUsd) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  });

  isLedActive(segmentIndex: number): boolean {
    const step = 100 / this.ledSegments.length;
    return this.budgetRatioPct() >= (segmentIndex + 1) * step - step / 2;
  }

  getInputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  onReplacementRateInput(event: Event): void {
    const parsed = Number(this.getInputValue(event));
    if (Number.isFinite(parsed) && parsed >= 0) {
      this.replacementRateChange.emit(parsed);
    }
  }

  onStrategyChange(event: Event): void {
    const val = this.getInputValue(event);
    if (val === 'MERGE' || val === 'REPLACE') {
      this.importStrategyChange.emit(val);
    }
  }

  onCsvTargetChange(event: Event): void {
    const val = this.getInputValue(event);
    if (val === 'CONTACTS' || val === 'BANKS' || val === 'ACTIVITIES') {
      this.csvTargetChange.emit(val);
    }
  }

  onJsonFileChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (file) {
      this.importJsonFile.emit(file);
      inputEl.value = '';
    }
  }

  onCsvFileChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (file) {
      this.importCsvFile.emit(file);
      inputEl.value = '';
    }
  }
}
