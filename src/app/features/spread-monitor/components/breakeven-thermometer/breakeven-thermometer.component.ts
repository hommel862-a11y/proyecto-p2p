import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FORMAT_PIPES } from '../../../../core/format';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';

export const BREAKEVEN_CYCLE_MODE = {
  SELL_INVENTORY: 'SELL_INVENTORY',
  REPLENISH_BUY: 'REPLENISH_BUY',
} as const;

export type BreakevenCycleMode =
  (typeof BREAKEVEN_CYCLE_MODE)[keyof typeof BREAKEVEN_CYCLE_MODE];

export const THERMOMETER_MARKER_ID = {
  FLOOR: 'floor',
  BID: 'bid',
  ASK: 'ask',
  TARGET: 'target',
} as const;

export type ThermometerMarkerId =
  (typeof THERMOMETER_MARKER_ID)[keyof typeof THERMOMETER_MARKER_ID];

export const THERMOMETER_VERDICT_TONE = {
  POSITIVE: 'positive',
  WARN: 'warn',
  DANGER: 'danger',
  NEUTRAL: 'neutral',
} as const;

export type ThermometerVerdictTone =
  (typeof THERMOMETER_VERDICT_TONE)[keyof typeof THERMOMETER_VERDICT_TONE];

export interface BreakevenRoiStep {
  roiPct: number;
  priceVes: number;
  profitVes: number;
  profitUsdt: number;
}

export interface BreakevenSplitItem {
  bankName: string;
  rail: string;
  allocationUsdt: number;
  capacityPct: number;
  safeTickets: number;
}

export interface ThermometerMarker {
  id: ThermometerMarkerId;
  label: string;
  priceVes: number;
  positionPct: number;
  lane: 'top' | 'bottom';
  tone: ThermometerMarkerId;
  deltaFromFloorVes: number;
}

export interface ThermometerVerdict {
  tone: ThermometerVerdictTone;
  badge: string;
  headline: string;
  guidance: string;
}

export interface BreakevenLadderRow {
  roiPct: number;
  priceVes: number;
  profitVes: number;
  profitUsdt: number;
  spreadVsFloorVes: number;
  isActive: boolean;
  execLabel: string;
  isImmediate: boolean;
}

interface RawThermometerPoint {
  id: ThermometerMarkerId;
  label: string;
  priceVes: number;
}

function sanitizeFinite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isValidQuote(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

@Component({
  selector: 'app-breakeven-thermometer',
  standalone: true,
  imports: [SpatialTilt3dDirective, ...FORMAT_PIPES],
  templateUrl: './breakeven-thermometer.component.html',
  styleUrl: './breakeven-thermometer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreakevenThermometerComponent {
  readonly floorPriceVes = input<number>(0);
  readonly targetPriceVes = input<number>(0);
  readonly targetRoiPct = input<number>(1.0);
  readonly netProfitVes = input<number>(0);
  readonly netProfitUsdt = input<number>(0);
  readonly bestBidVes = input<number | null>(null);
  readonly bestAskVes = input<number | null>(null);
  readonly cycleMode = input<BreakevenCycleMode>(BREAKEVEN_CYCLE_MODE.SELL_INVENTORY);
  readonly roiLadder = input<readonly BreakevenRoiStep[]>([]);
  readonly multiBankSplits = input<readonly BreakevenSplitItem[]>([]);

  readonly selectRoiTarget = output<number>();
  readonly launchTrade = output<void>();

  readonly splitExpanded = signal<boolean>(false);

  readonly isSellInventory = computed(
    () => this.cycleMode() === BREAKEVEN_CYCLE_MODE.SELL_INVENTORY,
  );

  readonly targetGapVes = computed<number>(() => {
    const floor = sanitizeFinite(this.floorPriceVes());
    const target = sanitizeFinite(this.targetPriceVes());
    return Number((target - floor).toFixed(2));
  });

  readonly thermometerMarkers = computed<readonly ThermometerMarker[]>(() => {
    const floor = sanitizeFinite(this.floorPriceVes());
    const target = sanitizeFinite(this.targetPriceVes());
    const bid = this.bestBidVes();
    const ask = this.bestAskVes();

    const raw: RawThermometerPoint[] = [
      { id: THERMOMETER_MARKER_ID.FLOOR, label: 'Piso', priceVes: floor },
    ];

    if (isValidQuote(bid)) {
      raw.push({ id: THERMOMETER_MARKER_ID.BID, label: 'Bid L2', priceVes: bid });
    }
    if (isValidQuote(ask)) {
      raw.push({ id: THERMOMETER_MARKER_ID.ASK, label: 'Ask L2', priceVes: ask });
    }
    raw.push({ id: THERMOMETER_MARKER_ID.TARGET, label: 'Tu Meta', priceVes: target });

    const prices = raw.map((item) => item.priceVes);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min;

    const normalized = raw.map((item) => {
      const positionPct =
        !Number.isFinite(span) || span <= 1e-9
          ? 50
          : Math.max(0, Math.min(100, Number((((item.priceVes - min) / span) * 100).toFixed(2))));

      return {
        id: item.id,
        label: item.label,
        priceVes: item.priceVes,
        positionPct,
        lane: 'top' as 'top' | 'bottom',
        tone: item.id,
        deltaFromFloorVes: Number((item.priceVes - floor).toFixed(2)),
      };
    });

    // Stagger markers vertically when two normalized positions sit close on the rail.
    const byPosition = [...normalized].sort((a, b) => a.positionPct - b.positionPct);
    let lastTopPct = -100;
    let lastBottomPct = -100;
    for (const marker of byPosition) {
      if (marker.positionPct - lastTopPct >= 14) {
        marker.lane = 'top';
        lastTopPct = marker.positionPct;
      } else if (marker.positionPct - lastBottomPct >= 14) {
        marker.lane = 'bottom';
        lastBottomPct = marker.positionPct;
      } else {
        marker.lane = lastTopPct <= lastBottomPct ? 'top' : 'bottom';
      }
    }

    return normalized;
  });

  readonly corridorRange = computed<{ startPct: number; widthPct: number }>(() => {
    const markers = this.thermometerMarkers();
    const floor = markers.find((m) => m.id === THERMOMETER_MARKER_ID.FLOOR);
    const target = markers.find((m) => m.id === THERMOMETER_MARKER_ID.TARGET);
    if (!floor || !target) {
      return { startPct: 50, widthPct: 0 };
    }
    const startPct = Math.min(floor.positionPct, target.positionPct);
    const widthPct = Math.abs(target.positionPct - floor.positionPct);
    return { startPct, widthPct };
  });

  readonly thermometerVerdict = computed<ThermometerVerdict>(() => {
    const floor = sanitizeFinite(this.floorPriceVes());
    const target = sanitizeFinite(this.targetPriceVes());
    const bid = this.bestBidVes();
    const ask = this.bestAskVes();

    if (this.isSellInventory()) {
      if (!isValidQuote(bid) || floor <= 0) {
        return {
          tone: THERMOMETER_VERDICT_TONE.NEUTRAL,
          badge: 'CORREDOR BASE',
          headline: 'Esperando referencia L2 en vivo',
          guidance: 'Conecta el libro de Binance para medir ejecutabilidad contra el piso.',
        };
      }
      if (target > 0 && bid >= target) {
        return {
          tone: THERMOMETER_VERDICT_TONE.POSITIVE,
          badge: 'SUPERÁVIT TOP 1',
          headline: 'Meta ejecutable en liquidez inmediata',
          guidance: 'El mejor Bid L2 cubre tu piso y alcanza el objetivo proyectado.',
        };
      }
      if (bid > floor) {
        return {
          tone: THERMOMETER_VERDICT_TONE.WARN,
          badge: 'ZONA RENTABLE',
          headline: 'Sobre piso breakeven · En cola hacia meta',
          guidance: 'Puedes salir rentable en Top 1 o esperar orden maker en tu objetivo.',
        };
      }
      return {
        tone: THERMOMETER_VERDICT_TONE.DANGER,
        badge: 'BAJO PISO BE',
        headline: 'Mercado por debajo de tu piso de defensa',
        guidance: 'Evita liquidar como taker; publica anuncio maker sobre el piso.',
      };
    }

    const marketRef = isValidQuote(ask) ? ask : bid;
    if (!isValidQuote(marketRef) || floor <= 0) {
      return {
        tone: THERMOMETER_VERDICT_TONE.NEUTRAL,
        badge: 'CORREDOR BASE',
        headline: 'Esperando referencia Ask L2 en vivo',
        guidance: 'Monitorea puntas de compra para validar techo de recompra.',
      };
    }
    if (target > 0 && marketRef <= target) {
      return {
        tone: THERMOMETER_VERDICT_TONE.POSITIVE,
        badge: 'RECOMPRA ÓPTIMA',
        headline: 'Ask L2 en o por debajo de tu recompra meta',
        guidance: 'Puedes recomprar inventario acumulando USDT extra al instante.',
      };
    }
    if (marketRef < floor) {
      return {
        tone: THERMOMETER_VERDICT_TONE.WARN,
        badge: 'BAJO TECHO BE',
        headline: 'Recompra rentable bajo el techo breakeven',
        guidance: 'El libro ofrece margen positivo, con espacio para esperar mejor cola.',
      };
    }
    return {
      tone: THERMOMETER_VERDICT_TONE.DANGER,
      badge: 'SOBRE TECHO BE',
      headline: 'Precio de mercado supera tu techo máximo',
      guidance: 'No recompres en Top 1; erosiona la ganancia del ciclo previo.',
    };
  });

  readonly ladderRows = computed<readonly BreakevenLadderRow[]>(() => {
    const floor = sanitizeFinite(this.floorPriceVes());
    const activeRoi = sanitizeFinite(this.targetRoiPct());
    const bid = this.bestBidVes();
    const ask = this.bestAskVes();
    const isSell = this.isSellInventory();

    return this.roiLadder().map((step) => {
      const hasMarketRef = isSell ? isValidQuote(bid) : isValidQuote(ask);
      const isImmediate = isSell
        ? isValidQuote(bid) && step.priceVes <= bid
        : isValidQuote(ask) && step.priceVes >= ask;

      return {
        roiPct: step.roiPct,
        priceVes: step.priceVes,
        profitVes: step.profitVes,
        profitUsdt: step.profitUsdt,
        spreadVsFloorVes: Number((step.priceVes - floor).toFixed(2)),
        isActive: Math.abs(step.roiPct - activeRoi) < 0.005,
        execLabel: !hasMarketRef ? 'Referencia' : isImmediate ? 'Top 1' : 'En Cola',
        isImmediate,
      };
    });
  });

  readonly totalSplitUsdt = computed<number>(() =>
    this.multiBankSplits().reduce(
      (sum, item) => sum + (Number.isFinite(item.allocationUsdt) ? item.allocationUsdt : 0),
      0,
    ),
  );

  readonly totalSafeTickets = computed<number>(() =>
    this.multiBankSplits().reduce(
      (sum, item) => sum + (Number.isFinite(item.safeTickets) ? item.safeTickets : 0),
      0,
    ),
  );

  toggleSplitDrawer(): void {
    this.splitExpanded.update((open) => !open);
  }

  onSelectRoi(roiPct: number): void {
    this.selectRoiTarget.emit(roiPct);
  }

  onSelectRoiSpace(event: Event, roiPct: number): void {
    event.preventDefault();
    this.onSelectRoi(roiPct);
  }

  onLaunchTrade(): void {
    this.launchTrade.emit();
  }
}
