import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { CleanRadarOffer } from '@p2p/core';
import type { RadarBotReportRow, RadarRejectedOfferRow } from '../../p2p-radar-ui.models';

@Component({
  selector: 'app-radar-forensic-view',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-forensic-view.component.html',
  styleUrl: './radar-forensic-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarForensicViewComponent {
  readonly bots = input.required<readonly RadarBotReportRow[]>();
  readonly rejectedOffers = input.required<readonly RadarRejectedOfferRow[]>();
  readonly bankLabels = input.required<Record<string, string>>();
  readonly reasonFormatter = input.required<(reason: string) => string>();

  readonly inspectBotProfile = output<RadarBotReportRow>();
  readonly inspectRejectedOffer = output<{
    readonly row: RadarRejectedOfferRow;
    readonly preferAdvertiser?: boolean;
  }>();

  hasAdvertiserId(advertiserNo?: string): boolean {
    return typeof advertiserNo === 'string' && advertiserNo.length > 0 && advertiserNo !== 'UNKNOWN';
  }

  bankName(key: string): string {
    return this.bankLabels()[key] || key;
  }

  formatReason(reason: string): string {
    return this.reasonFormatter()(reason);
  }
}
