import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { CleanRadarOffer } from '@p2p/core';
import type { BankPresetId } from '../../../../core/p2p-radar.service';
import type {
  RadarBankGroup,
  RadarBankViewModel,
  RadarDensityMode,
} from '../../p2p-radar-ui.models';

@Component({
  selector: 'app-radar-books-grid',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-books-grid.component.html',
  styleUrl: './radar-books-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarBooksGridComponent {
  readonly bankGroups = input.required<readonly RadarBankGroup[]>();
  readonly activeBanks = input.required<readonly string[]>();
  readonly activePreset = input.required<BankPresetId | 'CUSTOM'>();
  readonly densityMode = input.required<RadarDensityMode>();
  readonly bankLabels = input.required<Record<string, string>>();
  readonly bookViewModels = input.required<Map<string, RadarBankViewModel>>();

  readonly presetChange = output<BankPresetId>();
  readonly bankToggle = output<string>();
  readonly densityToggle = output<void>();
  readonly offerSelect = output<{
    readonly bank: string;
    readonly side: 'BUY' | 'SELL';
    readonly offer: CleanRadarOffer;
  }>();
  readonly offerExecute = output<{
    readonly bank: string;
    readonly side: 'BUY' | 'SELL';
    readonly offer: CleanRadarOffer;
    readonly preferAdvertiser?: boolean;
  }>();

  readonly presetOptions: readonly { id: BankPresetId; label: string }[] = [
    { id: 'TOP_VES', label: 'Top Líderes' },
    { id: 'ALL_VES', label: 'Todo VES' },
    { id: 'EXPANDED', label: 'VES + USD' },
    { id: 'CLEAR', label: 'Limpiar' },
  ];

  isBankActive(bankKey: string): boolean {
    return this.activeBanks().includes(bankKey);
  }

  bankLabel(bankKey: string): string {
    return this.bankLabels()[bankKey] || bankKey;
  }

  viewModelFor(bankKey: string): RadarBankViewModel | undefined {
    return this.bookViewModels().get(bankKey);
  }

  restrictionTitle(offer: CleanRadarOffer): string {
    const reasons = offer.takerRestrictionReasons;
    return reasons && reasons.length > 0 ? reasons.join(' · ') : 'Anuncio con restricción taker adicional';
  }

  hasAdvertiserId(offer: CleanRadarOffer): boolean {
    return typeof offer.advertiserNo === 'string' && offer.advertiserNo.length > 0 && offer.advertiserNo !== 'UNKNOWN';
  }

  onExecuteOffer(event: Event, bank: string, side: 'BUY' | 'SELL', offer: CleanRadarOffer, preferAdvertiser = false): void {
    event.stopPropagation();
    this.offerExecute.emit({ bank, side, offer, preferAdvertiser });
  }
}
