import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { ArbitrageRoute } from '@p2p/core';
import type { MatrixRouteFilter } from '../../p2p-radar-ui.models';

@Component({
  selector: 'app-radar-matrix-view',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-matrix-view.component.html',
  styleUrl: './radar-matrix-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarMatrixViewComponent {
  readonly routes = input.required<readonly ArbitrageRoute[]>();
  readonly filterMode = input.required<MatrixRouteFilter>();
  readonly targetMarginPct = input.required<number>();
  readonly bankLabels = input.required<Record<string, string>>();

  readonly filterChange = output<MatrixRouteFilter>();
  readonly selectRoute = output<ArbitrageRoute>();
  readonly executeRouteLeg = output<{
    readonly route: ArbitrageRoute;
    readonly leg: 'BUY' | 'SELL';
  }>();

  readonly filterOptions: readonly { id: MatrixRouteFilter; label: string }[] = [
    { id: 'ALL', label: 'Todas las Rutas' },
    { id: 'MONOBANK', label: 'Monobanco' },
    { id: 'INTERBANK', label: 'Interbancario' },
    { id: 'VIABLE', label: 'Viables' },
  ];

  bankName(key: string): string {
    return this.bankLabels()[key] || key;
  }

  strategyBadge(route: ArbitrageRoute): string {
    return route.recommendedMode === 'TAKER_COMPRA_MAKER_VENTA' ? 'Híbrido T+M' : '2x Maker';
  }
}
