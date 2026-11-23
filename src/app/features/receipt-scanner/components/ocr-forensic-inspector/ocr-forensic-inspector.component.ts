import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  BankReceiptRecord,
  BankType,
  FraudRiskFlag,
  FraudShieldAuditResult,
} from '@p2p/core';
import type { OcrDestinationMode } from '../../ocr-ui.models';

export type InspectorZoomLevel = 100 | 150 | 200;

interface BankSelectOption {
  readonly value: BankType;
  readonly label: string;
}

const BANK_OPTIONS: readonly BankSelectOption[] = [
  { value: 'BDV', label: 'Banco de Venezuela' },
  { value: 'BANESCO', label: 'Banesco Banco Universal' },
  { value: 'MERCANTIL', label: 'Mercantil Banco' },
  { value: 'PROVINCIAL', label: 'BBVA Provincial' },
  { value: 'BANCAMIGA', label: 'Bancamiga' },
  { value: 'BNC', label: 'Banco Nacional de Crédito' },
  { value: 'BANCARIBE', label: 'Bancaribe' },
  { value: 'BANPLUS', label: 'Banplus' },
  { value: 'BANCOLOMBIA', label: 'Bancolombia' },
  { value: 'NEQUI', label: 'Nequi Colombia' },
  { value: 'ZINLI', label: 'Zinli Wallet' },
  { value: 'EL_DORADO', label: 'El Dorado P2P' },
  { value: 'ZELLE', label: 'Zelle' },
  { value: 'WALLY', label: 'Wally Tech' },
  { value: 'BINANCE_PAY', label: 'Binance Pay' },
  { value: 'CASHEA', label: 'Cashea' },
  { value: 'FACEBANK', label: 'Facebank International' },
  { value: 'BANESCO_PANAMA', label: 'Banesco Panamá' },
  { value: 'MERCANTIL_PANAMA', label: 'Mercantil Panamá' },
  { value: 'PAGO_MOVIL_C2P', label: 'Pago Móvil C2P' },
  { value: 'UNKNOWN', label: 'Comprobante Desconocido' },
];

const BANK_DISPLAY_MAP: Readonly<Record<BankType, string>> = BANK_OPTIONS.reduce(
  (acc, item) => {
    acc[item.value] = item.label;
    return acc;
  },
  {} as Record<BankType, string>,
);

const CURRENCY_OPTIONS: readonly BankReceiptRecord['currency'][] = [
  'VES',
  'USD',
  'USDT',
  'EUR',
  'COP',
];

const ZOOM_OPTIONS: readonly InspectorZoomLevel[] = [100, 150, 200];

const FLAG_LABELS: Readonly<Record<FraudRiskFlag, string>> = {
  THIRD_PARTY_PAYER: 'Pago de Tercero',
  ID_DOCUMENT_MISMATCH: 'Cédula / RIF No Coincide',
  INVALID_BANK_REFERENCE: 'Referencia Inválida',
  AMOUNT_MISMATCH: 'Diferencia de Monto',
  CURRENCY_MISMATCH: 'Divisa No Coincide',
  BLACKLISTED_ENTITY: 'Entidad en Lista Negra',
  RAPID_REPEAT_REFERENCE: 'Referencia Repetida',
  SUSPICIOUS_ROUND_SUM: 'Monto Redondo Sospechoso',
  EXPIRED_OR_FUTURE_RECEIPT: 'Fecha Fuera de Rango',
};

@Component({
  selector: 'app-ocr-forensic-inspector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './ocr-forensic-inspector.component.html',
  styleUrl: './ocr-forensic-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.mode-p2p]': "destinationMode() === 'p2p'",
    '[class.mode-finance360]': "destinationMode() === 'finance360'",
  },
})
export class OcrForensicInspectorComponent {
  readonly receipt = input.required<BankReceiptRecord>();
  readonly audit = input<FraudShieldAuditResult | null>(null);
  readonly thumbnailDataUrl = input<string | null>(null);
  readonly imageHash = input<string | null>(null);
  readonly destinationMode = input<OcrDestinationMode>('p2p');
  readonly isSettled = input<boolean>(false);
  readonly isDriveBackedUp = input<boolean>(false);
  readonly isBackingUpDrive = input<boolean>(false);
  readonly casheaMatchLabel = input<string | null>(null);

  readonly closed = output<void>();
  readonly receiptUpdated = output<BankReceiptRecord>();
  readonly settleRequested = output<{ receipt: BankReceiptRecord; mode: OcrDestinationMode }>();
  readonly copyDossierEs = output<FraudShieldAuditResult>();
  readonly copyDossierEn = output<FraudShieldAuditResult>();
  readonly copyChatWarning = output<FraudShieldAuditResult>();
  readonly copyRefundInstructions = output<FraudShieldAuditResult>();
  readonly generatePdfReceipt = output<BankReceiptRecord>();
  readonly backupToDrive = output<BankReceiptRecord>();

  readonly bankOptions = BANK_OPTIONS;
  readonly currencyOptions = CURRENCY_OPTIONS;
  readonly zoomOptions = ZOOM_OPTIONS;

  readonly draftReceipt = linkedSignal<BankReceiptRecord>(() => ({ ...this.receipt() }));

  readonly zoomLevel = linkedSignal<string, InspectorZoomLevel>({
    source: () => this.receipt().id,
    computation: () => 100,
  });

  readonly rotationDeg = linkedSignal<string, number>({
    source: () => this.receipt().id,
    computation: () => 0,
  });

  readonly autoContrast = linkedSignal<string, boolean>({
    source: () => this.receipt().id,
    computation: () => false,
  });

  readonly invertDark = linkedSignal<string, boolean>({
    source: () => this.receipt().id,
    computation: () => false,
  });

  readonly imageTransform = computed<string>(
    () => `scale(${this.zoomLevel() / 100}) rotate(${this.rotationDeg()}deg)`,
  );

  readonly imageFilter = computed<string>(() => {
    const filters: string[] = [];
    if (this.autoContrast()) {
      filters.push('contrast(1.35) brightness(1.05)');
    }
    if (this.invertDark()) {
      filters.push('invert(1) hue-rotate(180deg)');
    }
    return filters.length > 0 ? filters.join(' ') : 'none';
  });

  readonly confidencePct = computed<number>(() => {
    const raw = this.draftReceipt().confidenceScore ?? 0;
    const clamped = Math.max(0, Math.min(1, raw));
    return Math.round(clamped * 100);
  });

  readonly shortImageHash = computed<string | null>(() => {
    const hash = this.imageHash()?.trim();
    if (!hash) {
      return null;
    }
    return hash.length > 16 ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : hash;
  });

  readonly verdictToneClass = computed<string>(() => {
    const level = this.audit()?.riskLevel;
    if (level === 'SAFE') {
      return 'tone-emerald';
    }
    if (level === 'WARNING') {
      return 'tone-warn';
    }
    if (level === 'CRITICAL') {
      return 'tone-danger';
    }
    return 'tone-neutral';
  });

  readonly verdictLabel = computed<string>(() => {
    const level = this.audit()?.riskLevel;
    if (level === 'SAFE') {
      return 'Verificado';
    }
    if (level === 'WARNING') {
      return 'Revisión Manual';
    }
    if (level === 'CRITICAL') {
      return 'Riesgo Crítico';
    }
    return 'Sin Auditoría';
  });

  readonly nameSimilarityPct = computed<number>(() => {
    const score = this.audit()?.nameMatch.score ?? 0;
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
  });

  readonly formattedAmountDiff = computed<string>(() => {
    const diff = this.audit()?.amountDifference ?? 0;
    const prefix = diff > 0 ? '+' : '';
    return `${prefix}${diff.toFixed(2)}`;
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.closed.emit();
  }

  setZoom(level: InspectorZoomLevel): void {
    this.zoomLevel.set(level);
  }

  rotateRight(): void {
    this.rotationDeg.update((deg) => (deg + 90) % 360);
  }

  toggleAutoContrast(): void {
    this.autoContrast.update((active) => !active);
  }

  toggleInvertDark(): void {
    this.invertDark.update((active) => !active);
  }

  flagLabel(flag: FraudRiskFlag): string {
    return FLAG_LABELS[flag] ?? flag;
  }

  onBankChange(bank: BankType): void {
    this.patchDraft({
      bank,
      bankDisplayName: BANK_DISPLAY_MAP[bank] ?? bank,
    });
  }

  onReferenceChange(reference: string): void {
    this.patchDraft({ reference });
  }

  onAmountChange(value: number | string | null): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    this.patchDraft({ amount });
  }

  onCurrencyChange(currency: BankReceiptRecord['currency']): void {
    this.patchDraft({ currency });
  }

  onPayerNameChange(payerName: string): void {
    this.patchDraft({ payerName });
  }

  onPayerIdChange(payerId: string): void {
    this.patchDraft({ payerId });
  }

  onBeneficiaryNameChange(beneficiaryName: string): void {
    this.patchDraft({ beneficiaryName });
  }

  onTimestampChange(timestamp: string): void {
    this.patchDraft({ timestamp });
  }

  onEmitDossierEs(): void {
    const currentAudit = this.audit();
    if (currentAudit) {
      this.copyDossierEs.emit(currentAudit);
    }
  }

  onEmitDossierEn(): void {
    const currentAudit = this.audit();
    if (currentAudit) {
      this.copyDossierEn.emit(currentAudit);
    }
  }

  onEmitChatWarning(): void {
    const currentAudit = this.audit();
    if (currentAudit) {
      this.copyChatWarning.emit(currentAudit);
    }
  }

  onEmitRefundInstructions(): void {
    const currentAudit = this.audit();
    if (currentAudit) {
      this.copyRefundInstructions.emit(currentAudit);
    }
  }

  onGeneratePdf(): void {
    this.generatePdfReceipt.emit(this.draftReceipt());
  }

  onBackupToDrive(): void {
    this.backupToDrive.emit(this.draftReceipt());
  }

  onConfirmSettle(): void {
    this.settleRequested.emit({
      receipt: this.draftReceipt(),
      mode: this.destinationMode(),
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  private patchDraft(patch: Partial<BankReceiptRecord>): void {
    const updated: BankReceiptRecord = {
      ...this.draftReceipt(),
      ...patch,
    };
    this.draftReceipt.set(updated);
    this.receiptUpdated.emit(updated);
  }
}
