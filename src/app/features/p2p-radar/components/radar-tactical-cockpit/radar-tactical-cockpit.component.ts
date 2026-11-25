import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { ExecutionMode } from '@p2p/core';
import type {
  RadarCockpitTab,
  RadarCockpitViewInput,
  TacticalPriceStrategy,
} from '../../p2p-radar-ui.models';

@Component({
  selector: 'app-radar-tactical-cockpit',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-tactical-cockpit.component.html',
  styleUrl: './radar-tactical-cockpit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarTacticalCockpitComponent {
  readonly view = input.required<RadarCockpitViewInput>();
  readonly cockpitTab = input.required<RadarCockpitTab>();
  readonly availableBanks = input.required<readonly string[]>();
  readonly copiedTarget = input<string | null>(null);

  readonly cockpitTabChange = output<RadarCockpitTab>();
  readonly buyBankChange = output<string>();
  readonly sellBankChange = output<string>();
  readonly swapBanks = output<void>();
  readonly priceInputChange = output<{ readonly side: 'BUY' | 'SELL'; readonly rawValue: string }>();
  readonly nudgePrice = output<{ readonly side: 'BUY' | 'SELL'; readonly delta: number }>();
  readonly tacticalStrategy = output<{ readonly side: 'BUY' | 'SELL'; readonly strategy: TacticalPriceStrategy }>();
  readonly copyTargetRate = output<{ readonly rate: number; readonly label: string }>();
  readonly copyMakerCard = output<void>();
  readonly recordCycle = output<void>();
  readonly dispatchToCrm = output<void>();
  readonly openCrm = output<void>();
  readonly copyDailySummary = output<void>();
  readonly switchExecutionMode = output<ExecutionMode>();

  bankName(key: string): string {
    return this.view().bankLabels[key] || key;
  }

  onBankSelect(side: 'BUY' | 'SELL', event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value;
    if (!val) return;
    if (side === 'BUY') this.buyBankChange.emit(val);
    else this.sellBankChange.emit(val);
  }

  onPriceChange(side: 'BUY' | 'SELL', event: Event): void {
    const val = (event.target as HTMLInputElement | null)?.value ?? '';
    this.priceInputChange.emit({ side, rawValue: val });
  }
}
