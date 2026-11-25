import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { ArbitrageRoute } from '@p2p/core';

@Component({
  selector: 'app-radar-opportunity-ticker',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-opportunity-ticker.component.html',
  styleUrl: './radar-opportunity-ticker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarOpportunityTickerComponent {
  readonly route = input<ArbitrageRoute | null>(null);
  readonly totalViable = input.required<number>();
  readonly bankLabels = input.required<Record<string, string>>();

  readonly inspectRoute = output<ArbitrageRoute>();

  bankName(key: string): string {
    return this.bankLabels()[key] || key;
  }
}
