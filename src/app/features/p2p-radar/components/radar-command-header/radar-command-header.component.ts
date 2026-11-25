import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type {
  ExecutionMode,
  MakerMerchantLevel,
  P2PUserTier,
  VolumeBracketConfig,
} from '@p2p/core';
import type { AutoRefreshIntervalSec } from '../../../../core/p2p-radar.service';
import type { RadarMerchantLevelOption, RadarViewMode } from '../../p2p-radar-ui.models';

export const MERCHANT_LEVEL_OPTIONS: readonly RadarMerchantLevelOption[] = [
  {
    id: 'STANDARD',
    label: 'Estándar',
    feePctLabel: '0.25%',
    hint: 'Cuenta sin insignia Bronce/Plata/Oro — optimiza con Taker Compra (0%) + Maker Venta (0.25%)',
  },
  {
    id: 'BRONZE',
    label: 'Bronce',
    feePctLabel: '0.20%',
    hint: 'Merchant Bronce verificado — comisión Maker 0.20% por pata',
  },
  {
    id: 'SILVER',
    label: 'Plata',
    feePctLabel: '0.175%',
    hint: 'Merchant Plata verificado — comisión Maker 0.175% por pata',
  },
  {
    id: 'GOLD',
    label: 'Oro',
    feePctLabel: '0.125%',
    hint: 'Merchant Oro institucional — comisión Maker 0.125% por pata',
  },
];

@Component({
  selector: 'app-radar-command-header',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-command-header.component.html',
  styleUrl: './radar-command-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarCommandHeaderComponent {
  readonly activeViewMode = input.required<RadarViewMode>();
  readonly loading = input.required<boolean>();
  readonly lastUpdated = input<Date | null>(null);
  readonly bufferSampleCount = input.required<number>();
  readonly merchantLevel = input.required<MakerMerchantLevel>();
  readonly userTier = input.required<P2PUserTier>();
  readonly currentMakerFeePct = input.required<number>();
  readonly executionMode = input.required<ExecutionMode>();
  readonly excludeMerchantCompetitors = input.required<boolean>();
  readonly requireOpenTakerOffers = input.required<boolean>();
  readonly operatingCapitalUsdt = input.required<number>();
  readonly targetNetMarginPct = input.required<number>();
  readonly interbankFrictionPct = input.required<number>();
  readonly volumeBrackets = input.required<readonly VolumeBracketConfig[]>();
  readonly selectedBracketId = input.required<string>();
  readonly autoRefreshIntervalSec = input.required<AutoRefreshIntervalSec>();
  readonly streamCountdownSec = input.required<number>();
  readonly soundAlertsActive = input.required<boolean>();
  readonly hudActive = input.required<boolean>();
  readonly paramsOpen = input.required<boolean>();
  readonly botsCount = input.required<number>();

  readonly viewModeChange = output<RadarViewMode>();
  readonly scanRequested = output<void>();
  readonly merchantLevelChange = output<MakerMerchantLevel>();
  readonly executionModeChange = output<ExecutionMode>();
  readonly excludeMerchantsToggle = output<boolean>();
  readonly requireOpenTakerToggle = output<boolean>();
  readonly capitalChange = output<number>();
  readonly marginTargetChange = output<number>();
  readonly interbankFrictionChange = output<number>();
  readonly volumeBracketChange = output<string>();
  readonly autoRefreshChange = output<AutoRefreshIntervalSec>();
  readonly soundToggle = output<void>();
  readonly hudToggle = output<void>();
  readonly cleanModalOpen = output<void>();
  readonly paramsToggle = output<void>();

  readonly merchantOptions = MERCHANT_LEVEL_OPTIONS;
  readonly refreshIntervals: readonly AutoRefreshIntervalSec[] = [0, 10, 15, 30];

  readonly viewTabs: readonly { id: RadarViewMode; label: string }[] = [
    { id: 'BOOKS', label: 'Libros Limpios' },
    { id: 'MATRIX', label: 'Matriz Arbitraje' },
    { id: 'FORENSIC', label: 'Escudo & Bots' },
  ];

  onNumberInput(event: Event, emitter: 'capital' | 'margin' | 'friction'): void {
    const inputEl = event.target as HTMLInputElement | null;
    if (!inputEl) return;
    const val = Number(inputEl.value);
    if (!Number.isFinite(val)) return;
    if (emitter === 'capital') this.capitalChange.emit(val);
    else if (emitter === 'margin') this.marginTargetChange.emit(val);
    else this.interbankFrictionChange.emit(val);
  }

  onBracketSelect(event: Event): void {
    const selEl = event.target as HTMLSelectElement | null;
    if (selEl?.value) {
      this.volumeBracketChange.emit(selEl.value);
    }
  }

  currentLevelLabel(): string {
    const found = this.merchantOptions.find((o) => o.id === this.merchantLevel());
    return found ? `${found.label} ${found.feePctLabel}` : this.merchantLevel();
  }
}
