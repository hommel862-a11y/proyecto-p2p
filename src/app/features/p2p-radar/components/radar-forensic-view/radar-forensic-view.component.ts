import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
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

  bankName(key: string): string {
    return this.bankLabels()[key] || key;
  }

  formatReason(reason: string): string {
    return this.reasonFormatter()(reason);
  }
}
