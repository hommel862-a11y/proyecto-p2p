import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  simulateCompoundGrowth,
  type CompoundSimulationInput,
  type CompoundSimulationResult,
  type DailyProjectionPoint,
} from '@p2p/core';
import { AnimatedCounterComponent } from '../../shared/ui/animated-counter';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { McpService } from '../../core/mcp.service';
import { ToastService } from '../../core/toast.service';

export interface SvgChartPoint {
  x: number;
  yCapital: number;
  yHarvest: number;
  point: DailyProjectionPoint;
}

@Component({
  selector: 'app-growth-projector',
  standalone: true,
  imports: [
    CommonModule,
    DecimalPipe,
    AnimatedCounterComponent,
  ],
  templateUrl: './growth-projector.html',
  styleUrls: ['./growth-projector.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrowthProjectorComponent implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly cotizaveService = inject(CotizaveService);
  private readonly binanceService = inject(BinanceP2pService);
  private readonly mcpService = inject(McpService);
  private readonly toast = inject(ToastService);

  readonly accountsCount = computed(() => this.accountsService.accounts().length);

  // Parámetros reactivos de entrada
  readonly initialCapitalUsdt = signal<number>(1000);
  readonly netMarginPctPerCycle = signal<number>(0.85);
  readonly cyclesPerDay = signal<number>(2);
  readonly operationalDays = signal<number>(90);
  readonly reinvestmentRatePct = signal<number>(100);
  readonly monthlyFixedExpensesUsdt = signal<number>(200);

  // Opciones y estado de UI
  readonly useMcpLiveRates = signal<boolean>(true);
  readonly activeHorizonDays = signal<number>(90);
  readonly hoveredPoint = signal<DailyProjectionPoint | null>(null);
  readonly hoveredCoords = signal<{ x: number; y: number } | null>(null);
  readonly isTableExpanded = signal<boolean>(false);
  readonly isMcpRunning = signal<boolean>(false);
  readonly isSyncingMargin = signal<boolean>(false);
  readonly mcpVerdict = signal<string | null>(null);

  ngOnInit(): void {
    // Precarga silenciosa en background para que el spread y las tasas estén frescas
    void this.binanceService.fetchMarketDepth('USDT', 'VES', true).catch(() => {});
    void this.cotizaveService.refreshIfStale().catch(() => {});
  }

  // Límites bancarios consolidados reales de las 16 cuentas de AccountsService
  readonly consolidatedDailyBankLimitVes = computed<number>(() => {
    return this.accountsService.accounts().reduce((acc, a) => acc + (a.dailyLimitVes || 0), 0) || 500000;
  });

  // Tasa de cambio de referencia en vivo (Cotizave o fallback de mercado)
  readonly referenceRateVes = computed<number>(() => {
    if (!this.useMcpLiveRates()) {
      return 60.0;
    }
    const rates = this.cotizaveService.ratesByMarket();
    const par = rates['parallel'];
    const parVal = par?.mid ?? par?.ask ?? par?.bid;
    if (parVal && parVal > 0) {
      return parVal;
    }
    const bcv = rates['bcv'] ?? rates['oficial'];
    const bcvVal = bcv?.mid ?? bcv?.ask ?? bcv?.bid;
    if (bcvVal && bcvVal > 0) {
      return bcvVal;
    }
    return 60.0;
  });

  // Spread neto de mercado en vivo si BinanceP2pService tiene profundidad
  readonly liveNetMarginSpread = computed<number | null>(() => {
    const depth = this.binanceService.marketDepth();
    if (depth && depth.spreadPct > 0) {
      // Descontar ~0.35% de comisiones típicas P2P Maker/Taker
      const net = Math.max(0.1, depth.spreadPct - 0.35);
      return Number(net.toFixed(2));
    }
    return null;
  });

  // Saldo real en tesorería convertido a USDT según la tasa de mercado
  readonly treasuryBalanceUsdt = computed<number>(() => {
    const ves = this.accountsService.treasurySummary()?.totalBalanceVes ?? 0;
    const rate = this.referenceRateVes();
    return rate > 0 ? Number((ves / rate).toFixed(2)) : 0;
  });

  // Opciones de verificación de límite bancario (por defecto desactivado para proyectar libremente el capital ingresado)
  readonly checkBankingWall = signal<boolean>(false);
  readonly bankLimitMode = signal<'accounts' | 'custom'>('accounts');
  readonly customDailyLimitVes = signal<number>(5000000);

  // Límite bancario efectivo a aplicar en la simulación (undefined si el usuario no desea restricción bancaria)
  readonly effectiveDailyBankLimitVes = computed<number | undefined>(() => {
    if (!this.checkBankingWall()) {
      return undefined;
    }
    return this.bankLimitMode() === 'custom'
      ? this.customDailyLimitVes()
      : this.consolidatedDailyBankLimitVes();
  });

  // Resultado de la simulación matemática de crecimiento compuesto (Pura & Determinística)
  readonly simulationResult = computed<CompoundSimulationResult>(() => {
    const initCap = Math.max(10, this.initialCapitalUsdt());
    const margin = Math.max(0.01, this.netMarginPctPerCycle());
    const cycles = Math.max(0.1, this.cyclesPerDay());
    const days = Math.max(1, this.operationalDays());
    const reinvest = Math.min(100, Math.max(0, this.reinvestmentRatePct()));
    const bankLimit = this.effectiveDailyBankLimitVes();
    const refRate = this.referenceRateVes();

    return simulateCompoundGrowth({
      initialCapitalUsdt: initCap,
      netMarginPctPerCycle: margin,
      cyclesPerDay: cycles,
      operationalDays: days,
      reinvestmentRatePct: reinvest,
      dailyBankLimitVes: bankLimit,
      referenceRateVes: refRate,
    });
  });

  // Múltiplos y métricas clave
  readonly capitalGrowthMultiplier = computed<string>(() => {
    const res = this.simulationResult();
    const mult = res.finalWorkingCapitalUsdt / res.initialCapitalUsdt;
    return mult.toFixed(2) + 'x';
  });

  readonly monthlyRunwayCoverageMonths = computed<number>(() => {
    const exp = this.monthlyFixedExpensesUsdt();
    if (exp <= 0) return 99;
    const profit = this.simulationResult().totalNetProfitUsdt;
    return Number((profit / exp).toFixed(1));
  });

  // Geometría del gráfico interactivo SVG nativo (Viewport: 800 x 320)
  readonly svgWidth = 800;
  readonly svgHeight = 320;
  readonly svgPadding = { top: 25, right: 30, bottom: 40, left: 60 };

  readonly chartPoints = computed<SvgChartPoint[]>(() => {
    const projection = this.simulationResult().dailyProjection;
    if (projection.length === 0) return [];

    const plotW = this.svgWidth - this.svgPadding.left - this.svgPadding.right;
    const plotH = this.svgHeight - this.svgPadding.top - this.svgPadding.bottom;

    const maxVal = Math.max(
      ...projection.map((p) => Math.max(p.endingCapitalUsdt, p.totalPortfolioValueUsdt)),
      100
    );
    const minVal = Math.min(...projection.map((p) => p.startingCapitalUsdt), 0);
    const valRange = Math.max(1, maxVal - minVal);

    const stepX = plotW / Math.max(1, projection.length - 1);

    return projection.map((point, index) => {
      const x = this.svgPadding.left + index * stepX;
      const normalizedCap = (point.endingCapitalUsdt - minVal) / valRange;
      const normalizedHarvest = (point.cumulativeHarvestedUsdt) / valRange;

      const yCapital = this.svgHeight - this.svgPadding.bottom - normalizedCap * plotH;
      const yHarvest = this.svgHeight - this.svgPadding.bottom - normalizedHarvest * plotH;

      return {
        x: Number(x.toFixed(1)),
        yCapital: Number(yCapital.toFixed(1)),
        yHarvest: Number(yHarvest.toFixed(1)),
        point,
      };
    });
  });

  readonly capitalAreaPath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const bottomY = this.svgHeight - this.svgPadding.bottom;
    const lineCommands = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yCapital}`).join(' ');
    const closeCommand = `L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;
    return `${lineCommands} ${closeCommand}`;
  });

  readonly capitalLinePath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yCapital}`).join(' ');
  });

  readonly harvestAreaPath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0 || this.reinvestmentRatePct() === 100) return '';
    const bottomY = this.svgHeight - this.svgPadding.bottom;
    const lineCommands = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yHarvest}`).join(' ');
    const closeCommand = `L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;
    return `${lineCommands} ${closeCommand}`;
  });

  readonly harvestLinePath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0 || this.reinvestmentRatePct() === 100) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yHarvest}`).join(' ');
  });

  // Detección de la coordenada X donde se golpea el Muro Bancario SUDEBAN
  readonly bankingWallX = computed<number | null>(() => {
    const wall = this.simulationResult().bankingWallAlert;
    if (!wall) return null;
    const pts = this.chartPoints();
    const found = pts.find((p) => p.point.day === wall.firstDayExceeded);
    return found ? found.x : null;
  });

  // Métodos de interacción y configuración de presets
  setInitialCapital(amount: number): void {
    this.initialCapitalUsdt.set(amount);
  }

  loadFromTreasury(): void {
    const bal = this.treasuryBalanceUsdt();
    if (bal > 0) {
      this.initialCapitalUsdt.set(bal);
      this.toast.info(`Capital inicial fijado al saldo de tesorería: $${bal.toLocaleString()} USDT`, 'Tesorería Sincronizada');
    } else {
      this.toast.warn('No hay saldo positivo en tesorería para cargar.', 'Tesorería');
    }
  }

  toggleBankingWall(): void {
    this.checkBankingWall.update((v) => !v);
  }

  setOperationalDays(days: number): void {
    this.operationalDays.set(days);
    this.activeHorizonDays.set(days);
  }

  setReinvestmentPolicy(pct: number): void {
    this.reinvestmentRatePct.set(pct);
  }

  async applyLiveNetMargin(): Promise<void> {
    this.isSyncingMargin.set(true);
    try {
      // 1. Intentar refrescar o consultar la profundidad en vivo de Binance P2P
      let depth = this.binanceService.marketDepth();
      if (!depth || depth.spreadPct <= 0) {
        depth = await this.binanceService.fetchMarketDepth('USDT', 'VES', true);
      }

      if (depth && depth.spreadPct > 0) {
        const net = Math.max(0.1, Number((depth.spreadPct - 0.35).toFixed(2)));
        this.netMarginPctPerCycle.set(net);
        this.toast.success(
          `Margen neto actualizado desde Binance P2P en vivo: ${net}% (Spread bruto: ${depth.spreadPct.toFixed(2)}%)`,
          'Binance P2P Live'
        );
        return;
      }

      // 2. Fallback al servidor MCP si la llamada directa no arrojó profundidad
      const mcpOrderbook = await this.mcpService.getBinanceP2pOrderbook({ fiat: 'VES', asset: 'USDT', rows: 10 });
      if (mcpOrderbook && mcpOrderbook.result) {
        const res = mcpOrderbook.result as Record<string, unknown>;
        const mcpSpread = Number(res['spreadPct'] ?? 0);
        if (mcpSpread > 0) {
          const net = Math.max(0.1, Number((mcpSpread - 0.35).toFixed(2)));
          this.netMarginPctPerCycle.set(net);
          this.toast.success(
            `Margen neto obtenido vía Servidor MCP: ${net}% (Spread: ${mcpSpread.toFixed(2)}%)`,
            'Servidor MCP'
          );
          return;
        }
      }

      // 3. Fallback a Cotizave P2P si existe cotización de Binance en Cotizave
      const cotizaveRates = this.cotizaveService.ratesByMarket();
      const binanceRate = cotizaveRates['binance'];
      if (binanceRate && binanceRate.ask && binanceRate.bid && binanceRate.bid > 0) {
        const gross = ((binanceRate.ask - binanceRate.bid) / binanceRate.bid) * 100;
        if (gross > 0) {
          const net = Math.max(0.1, Number((gross - 0.35).toFixed(2)));
          this.netMarginPctPerCycle.set(net);
          this.toast.info(
            `Margen neto derivado de Cotizave P2P: ${net}%`,
            'Cotizave P2P'
          );
          return;
        }
      }

      // Si no hay respuesta disponible de ninguna fuente
      this.toast.warn(
        'No se pudo conectar con la API de Binance ni el Servidor MCP. Podés ingresar el margen manualmente.',
        'Conexión no disponible'
      );
    } catch {
      this.toast.warn(
        'Error al sincronizar con el mercado en vivo. Podés calibrar el margen manualmente.',
        'Error de Sincronización'
      );
    } finally {
      this.isSyncingMargin.set(false);
    }
  }

  toggleTable(): void {
    this.isTableExpanded.update((v) => !v);
  }

  onPointHover(p: SvgChartPoint): void {
    this.hoveredPoint.set(p.point);
    this.hoveredCoords.set({ x: p.x, y: p.yCapital });
  }

  onMouseLeaveChart(): void {
    this.hoveredPoint.set(null);
    this.hoveredCoords.set(null);
  }

  async runMcpInstitutionalAudit(): Promise<void> {
    this.isMcpRunning.set(true);
    this.mcpVerdict.set(null);
    try {
      const response = await this.mcpService.projectCompoundRunway({
        initialCapitalUsdt: this.initialCapitalUsdt(),
        netMarginPctPerCycle: this.netMarginPctPerCycle(),
        cyclesPerDay: this.cyclesPerDay(),
        operationalDays: this.operationalDays(),
        reinvestmentRatePct: this.reinvestmentRatePct(),
        monthlyFixedExpensesUsdt: this.monthlyFixedExpensesUsdt(),
        dailyBankLimitVes: this.consolidatedDailyBankLimitVes(),
        referenceRateVes: this.referenceRateVes(),
      });

      if (response && response.result) {
        const r = response.result as Record<string, unknown>;
        const summary = (r['executiveSummary'] as string) || 'Auditoría completada exitosamente.';
        this.mcpVerdict.set(summary);
        this.toast.success('Auditoría cuantitativa MCP sincronizada.', 'Servidor MCP');
      } else {
        this.mcpVerdict.set('Auditoría completada con éxito local.');
      }
    } catch {
      this.mcpVerdict.set('Servidor MCP no disponible temporalmente. Proyección local activa.');
    } finally {
      this.isMcpRunning.set(false);
    }
  }

  exportToCsv(): void {
    const points = this.simulationResult().dailyProjection;
    if (points.length === 0) return;

    const headers = [
      'Dia',
      'Capital_Inicial_USDT',
      'Ganancia_Diaria_USDT',
      'Reinvertido_USDT',
      'Cosechado_USDT',
      'Capital_Final_USDT',
      'Cosecha_Acumulada_USDT',
      'Volumen_VES',
      'Excede_Limite_Bancario',
    ];

    const rows = points.map((p) => [
      p.day,
      p.startingCapitalUsdt.toFixed(2),
      p.dailyGrossGainUsdt.toFixed(2),
      p.reinvestedGainUsdt.toFixed(2),
      p.harvestedGainUsdt.toFixed(2),
      p.endingCapitalUsdt.toFixed(2),
      p.cumulativeHarvestedUsdt.toFixed(2),
      p.dailyVolumeVes.toFixed(0),
      p.exceedsBankLimit ? 'SI' : 'NO',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `proyeccion_p2p_${this.operationalDays()}dias.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success('Reporte CSV descargado correctamente.', 'Exportación Completa');
  }
}
