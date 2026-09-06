import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import {
  evaluateRepricer,
  type RepricerConfig,
  type RepricerDecision,
  type RepricerStrategy,
} from '@p2p/core';

export interface RepricerLogEntry {
  timestamp: string;
  action: 'UPDATE' | 'KEEP' | 'PAUSE';
  message: string;
  spreadVes: number;
  isDryRun: boolean;
}

@Injectable({ providedIn: 'root' })
export class BinanceRepricerService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);

  readonly isActive = signal<boolean>(false);
  readonly isDryRun = signal<boolean>(true);
  readonly strategy = signal<RepricerStrategy>('TOP_1');
  readonly stepVes = signal<number>(0.05);
  readonly minSpreadVes = signal<number>(10.0);
  readonly breakEvenFloor = signal<number>(0);
  readonly maxBuyPrice = signal<number>(0);

  readonly currentBuyAdPrice = signal<number>(0);
  readonly currentSellAdPrice = signal<number>(0);

  readonly lastDecision = signal<RepricerDecision | null>(null);
  readonly logs = signal<RepricerLogEntry[]>([]);
  readonly intervalSeconds = signal<number>(20);

  private loopTimer: ReturnType<typeof setInterval> | null = null;

  ngOnDestroy(): void {
    this.stop();
  }

  toggle(): void {
    if (this.isActive()) {
      this.stop();
      this.toast.info('Bot de Repricing pausado.', 'Mesa de Operaciones');
    } else {
      this.start();
      this.toast.success(
        `Bot de Repricing activado (${this.isDryRun() ? 'Modo Simulación' : 'Modo En Vivo'}).`,
        'Mesa de Operaciones',
      );
    }
  }

  start(): void {
    this.stop();
    this.isActive.set(true);
    void this.executeCycle();

    this.loopTimer = setInterval(() => {
      if (this.isActive()) {
        void this.executeCycle();
      }
    }, this.intervalSeconds() * 1000);
  }

  stop(): void {
    this.isActive.set(false);
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  killSwitch(): void {
    this.stop();
    this.addLog(
      'PAUSE',
      '🚨 KILL-SWITCH ACTIVADO: Bot detenido inmediatamente por el operador.',
      0,
    );
    this.toast.error('Bot de Repricing apagado de emergencia (Kill-Switch).', 'Seguridad P2P');
  }

  setStrategy(strat: RepricerStrategy): void {
    this.strategy.set(strat);
    if (this.isActive()) void this.executeCycle();
  }

  setDryRun(dryRun: boolean): void {
    this.isDryRun.set(dryRun);
    this.toast.info(
      dryRun ? 'Modo Simulación activado (no toca anuncios reales).' : 'Modo En Vivo activado.',
      'Configuración Repricer',
    );
  }

  async executeCycle(): Promise<RepricerDecision | null> {
    const depth = await this.binance.fetchMarketDepth('USDT', 'VES');
    if (!depth) {
      return null;
    }

    // Check if any daily bank account cupo is breached
    const usages = this.accounts.usages();
    const isLimitExceeded = usages.some((u) => u.isOverLimit);

    const config: RepricerConfig = {
      asset: 'USDT',
      fiat: 'VES',
      strategy: this.strategy(),
      stepVes: this.stepVes(),
      minSpreadVes: this.minSpreadVes(),
      breakEvenSellPrice: this.breakEvenFloor(),
      maxBuyPrice: this.maxBuyPrice(),
      isDryRun: this.isDryRun(),
    };

    const decision = evaluateRepricer({
      config,
      marketDepth: depth,
      currentBuyAdPrice: this.currentBuyAdPrice() > 0 ? this.currentBuyAdPrice() : undefined,
      currentSellAdPrice: this.currentSellAdPrice() > 0 ? this.currentSellAdPrice() : undefined,
      isDailyLimitExceeded: isLimitExceeded,
    });

    this.lastDecision.set(decision);

    if (decision.action === 'UPDATE') {
      this.currentBuyAdPrice.set(decision.suggestedBuyPrice);
      this.currentSellAdPrice.set(decision.suggestedSellPrice);
      const prefix = this.isDryRun() ? '[SIMULACIÓN] ' : '[EN VIVO] ';
      this.addLog(
        'UPDATE',
        `${prefix}Precios optimizados: Compra ${decision.suggestedBuyPrice} Bs | Venta ${decision.suggestedSellPrice} Bs (${this.strategy()})`,
        decision.spreadVes,
      );
    } else if (decision.action === 'PAUSE') {
      this.stop();
      this.addLog(
        'PAUSE',
        `🛑 Bot pausado por regla de seguridad: ${decision.reason}`,
        decision.spreadVes,
      );
      this.toast.error(decision.reason, 'Alerta Repricer P2P');
    } else {
      this.addLog(
        'KEEP',
        'Precios en posición óptima en el libro. Sin cambios.',
        decision.spreadVes,
      );
    }

    return decision;
  }

  private addLog(action: 'UPDATE' | 'KEEP' | 'PAUSE', message: string, spreadVes: number): void {
    const entry: RepricerLogEntry = {
      timestamp: new Date().toLocaleTimeString('es-VE'),
      action,
      message,
      spreadVes,
      isDryRun: this.isDryRun(),
    };
    this.logs.update((prev) => [entry, ...prev.slice(0, 19)]);
  }
}
