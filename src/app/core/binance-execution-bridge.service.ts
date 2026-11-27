import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import {
  buildBinanceAdvPostUrl,
  buildBinanceMyAdsUrl,
  evaluateTakerPreFlight,
  isAllowedBinanceExecutionUrl,
  resolveBinanceExecutionTarget,
  type CounterpartyReputationLevel,
  type PreFlightIssue,
  type TakerAction,
  type TakerPreFlightOffer,
  type TakerPreFlightResult,
} from '@p2p/core';
import type { BinanceDockMode, BinanceDockStateDto } from '../../../electron/shared/types';
import { CounterpartyService } from './counterparty.service';
import { StorageService } from './storage';
import { ToastService } from './toast.service';
import { TradeTimerService, type TradePreset } from './trade-timer.service';

const PREFER_DOCK_STORAGE_KEY = 'p2p.exec.preferDock';

export interface ExecutionHudContext {
  readonly url: string;
  readonly mode: BinanceDockMode;
  readonly action: TakerAction;
  readonly advNo?: string;
  readonly advertiserNo?: string;
  readonly merchantName: string;
  readonly price: number;
  readonly bank?: string;
  readonly copiedAmount: string;
  readonly executableVes: number;
  readonly executableUsdt: number;
  readonly issues: readonly PreFlightIssue[];
  readonly timestamp: number;
}

export interface ExecuteOfferActionParams {
  readonly action: TakerAction;
  readonly offer: TakerPreFlightOffer & {
    readonly merchantName?: string;
    readonly nickName?: string;
    readonly payMethods?: readonly string[];
  };
  readonly expectedPrice?: number;
  readonly targetUsdt?: number;
  readonly targetVes?: number;
  readonly maxSlippagePct?: number;
  readonly bank?: string;
  readonly preferAdvertiser?: boolean;
  readonly armTradeTimer?: boolean;
  readonly accountAgeDays?: number;
  readonly btcPosition?: number;
}

@Injectable({ providedIn: 'root' })
export class BinanceExecutionBridgeService {
  private readonly counterparty = inject(CounterpartyService);
  private readonly toast = inject(ToastService);
  private readonly timer = inject(TradeTimerService);
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly preferEmbeddedDock = signal<boolean>(this.loadPreferDock());
  readonly activeHudContext = signal<ExecutionHudContext | null>(null);
  readonly dockState = signal<BinanceDockStateDto>({
    isOpen: false,
    currentUrl: null,
    widthPx: 0,
    mode: null,
  });
  readonly lastPreFlight = signal<TakerPreFlightResult | null>(null);

  constructor() {
    if (typeof window !== 'undefined' && window.electron?.binanceDock?.onStateChanged) {
      const unsub = window.electron.binanceDock.onStateChanged((next) => {
        this.dockState.set(next);
      });
      this.destroyRef.onDestroy(() => unsub());
    }
  }

  setPreferEmbeddedDock(prefer: boolean): void {
    this.preferEmbeddedDock.set(prefer);
    try {
      this.storage.set(PREFER_DOCK_STORAGE_KEY, prefer);
    } catch {
      // non-blocking
    }
  }

  /**
   * Executes a 1-click Taker or Profile jump:
   * 1) Checks immutable `binanceUserNo` / nickName against CRM blacklist.
   * 2) Runs pre-flight guard (liquidity, limits, slippage, taker locks).
   * 3) Falls back to advertiser profile when the specific ad just expired/slipped.
   * 4) Copies the executable amount to clipboard & updates HUD / TradeTimer.
   * 5) Opens the official Binance URL in the isolated Electron dock or external tab.
   */
  async executeOfferAction(params: ExecuteOfferActionParams): Promise<TakerPreFlightResult> {
    const merchantName = (params.offer.merchantName ?? params.offer.nickName ?? 'Anunciante').trim();
    const cp =
      typeof this.counterparty.findByBinanceIdentity === 'function'
        ? this.counterparty.findByBinanceIdentity(params.offer.advertiserNo, merchantName)
        : this.counterparty.findByQuery(merchantName);
    const reputation: CounterpartyReputationLevel =
      !cp || cp.reputation === 'NORMAL' ? 'UNKNOWN' : cp.reputation;

    const preFlight = evaluateTakerPreFlight({
      action: params.action,
      offer: params.offer,
      expectedPrice: params.expectedPrice,
      targetUsdt: params.targetUsdt,
      targetVes: params.targetVes,
      maxSlippagePct: params.maxSlippagePct,
      counterpartyReputation: reputation,
      operator:
        params.accountAgeDays !== undefined || params.btcPosition !== undefined
          ? { accountAgeDays: params.accountAgeDays, btcPosition: params.btcPosition }
          : undefined,
    });

    this.lastPreFlight.set(preFlight);

    const hasIssue = (code: PreFlightIssue['code']) =>
      preFlight.issues.some((issue) => issue.code === code);

    // Hard blocks: blacklisted counterparty, invalid price, or zero valid identifiers
    if (hasIssue('COUNTERPARTY_BLOCKED') || hasIssue('INVALID_PRICE') || hasIssue('NO_DEEP_LINK')) {
      const msg = preFlight.issues.map((i) => i.message).join(' ');
      this.toast.error(msg || 'Operación bloqueada por Pre-Flight Guard.', 'Pre-Flight Guard');
      return preFlight;
    }

    // Resolve target URL (honor explicit profile request OR fallback when ad exhausted/slipped)
    let resolvedTarget = resolveBinanceExecutionTarget({
      advNo: params.offer.advNo,
      advertiserNo: params.offer.advertiserNo,
      preferAdvertiser: params.preferAdvertiser,
    });

    const adDegraded = hasIssue('AD_EXHAUSTED') || hasIssue('SLIPPAGE_EXCEEDED');
    if (adDegraded) {
      if (resolvedTarget.advertiserUrl && !params.preferAdvertiser) {
        resolvedTarget = {
          kind: 'ADVERTISER',
          url: resolvedTarget.advertiserUrl,
          adUrl: resolvedTarget.adUrl,
          advertiserUrl: resolvedTarget.advertiserUrl,
        };
        this.toast.warn(
          'Anuncio agotado o con slippage: redirigiendo al perfil del anunciante.',
          'Fallback Inteligente',
        );
      } else {
        const msg = preFlight.issues.map((i) => i.message).join(' ');
        this.toast.error(msg, 'Pre-Flight Guard');
        return preFlight;
      }
    } else if (preFlight.verdict === 'BLOCK' && !params.preferAdvertiser) {
      const msg = preFlight.issues
        .filter((i) => i.severity === 'BLOCK')
        .map((i) => i.message)
        .join(' ');
      this.toast.error(msg, 'Pre-Flight Guard');
      return preFlight;
    }

    if (!resolvedTarget.url || !isAllowedBinanceExecutionUrl(resolvedTarget.url)) {
      this.toast.error('URL de ejecución de Binance no válida.', 'Pre-Flight Guard');
      return preFlight;
    }

    if (preFlight.verdict === 'WARN' && !adDegraded) {
      const warnSummary = preFlight.issues.map((i) => i.message).join(' · ');
      this.toast.warn(warnSummary, 'Aviso Pre-Flight');
    }

    const copiedAmount =
      preFlight.executableVes > 0
        ? preFlight.executableVes.toFixed(2)
        : params.targetUsdt && params.targetUsdt > 0
          ? params.targetUsdt.toFixed(2)
          : '';
    if (copiedAmount) {
      await this.copyTextSafely(copiedAmount);
    }

    const mode: BinanceDockMode = resolvedTarget.kind === 'ADVERTISER' ? 'ADVERTISER' : 'AD';
    const bankLabel = params.bank || params.offer.payMethods?.[0];

    this.activeHudContext.set({
      url: resolvedTarget.url,
      mode,
      action: params.action,
      advNo: params.offer.advNo,
      advertiserNo: params.offer.advertiserNo,
      merchantName,
      price: params.offer.price,
      bank: bankLabel,
      copiedAmount,
      executableVes: preFlight.executableVes,
      executableUsdt: preFlight.executableUsdt,
      issues: preFlight.issues,
      timestamp: Date.now(),
    });

    if (params.armTradeTimer) {
      const preset: TradePreset = {
        pair: 'USDT',
        type: params.action === 'BUY' ? 'buy' : 'sell',
        price: params.offer.price,
        vesAmount: preFlight.executableVes,
        usdtAmount: preFlight.executableUsdt,
        merchantNote: `Binance P2P · ${merchantName}`,
        advNo: params.offer.advNo,
        advertiserNo: params.offer.advertiserNo,
        merchantName,
        bank: bankLabel,
      };
      this.timer.start(preset);
    }

    await this.openUrl(resolvedTarget.url, mode);
    return preFlight;
  }

  /** Opens Binance P2P `myads` (fast repricing) or `advPost` (new ad) for human-in-the-loop publishing. */
  async openMerchantPortal(mode: 'myads' | 'advPost', summaryToCopy?: string): Promise<void> {
    const url = mode === 'myads' ? buildBinanceMyAdsUrl() : buildBinanceAdvPostUrl();
    const dockMode: BinanceDockMode = mode === 'myads' ? 'MY_ADS' : 'ADV_POST';

    if (summaryToCopy && summaryToCopy.trim().length > 0) {
      await this.copyTextSafely(summaryToCopy);
    }

    this.activeHudContext.set({
      url,
      mode: dockMode,
      action: 'BUY',
      merchantName: mode === 'myads' ? 'Mis Anuncios Binance' : 'Publicar Anuncio P2P',
      price: 0,
      copiedAmount: '',
      executableVes: 0,
      executableUsdt: 0,
      issues: [],
      timestamp: Date.now(),
    });

    await this.openUrl(url, dockMode);
  }

  async closeDock(): Promise<void> {
    if (typeof window !== 'undefined' && window.electron?.binanceDock?.close) {
      const next = await window.electron.binanceDock.close();
      this.dockState.set(next);
    }
  }

  dismissHud(): void {
    this.activeHudContext.set(null);
    void this.closeDock();
  }

  async openActiveInExternalBrowser(): Promise<void> {
    const url = this.dockState().currentUrl ?? this.activeHudContext()?.url;
    if (!url || !isAllowedBinanceExecutionUrl(url)) return;
    if (typeof window !== 'undefined' && window.electron?.binanceDock?.openExternal) {
      await window.electron.binanceDock.openExternal(url);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  sendActiveContextToLog(): void {
    const ctx = this.activeHudContext();
    if (ctx && ctx.price > 0) {
      this.timer.pendingPreset.set({
        pair: 'USDT',
        type: ctx.action === 'BUY' ? 'buy' : 'sell',
        price: ctx.price,
        vesAmount: ctx.executableVes,
        usdtAmount: ctx.executableUsdt,
        merchantNote: `Binance P2P · ${ctx.merchantName}`,
        advNo: ctx.advNo,
        advertiserNo: ctx.advertiserNo,
        merchantName: ctx.merchantName,
        bank: ctx.bank,
      });
    }
    void this.router?.navigate(['/log']);
  }

  async copyHudAmount(): Promise<void> {
    const amount = this.activeHudContext()?.copiedAmount;
    if (!amount) return;
    await this.copyTextSafely(amount);
    this.toast.success(`Monto ${amount} copiado al portapapeles.`, 'Ejecución Rápida');
  }

  private async openUrl(url: string, mode: BinanceDockMode): Promise<void> {
    if (typeof window === 'undefined') return;
    const dock = window.electron?.binanceDock;
    if (dock && this.preferEmbeddedDock()) {
      const next = await dock.open({ url, mode });
      this.dockState.set(next);
      return;
    }
    if (dock?.openExternal) {
      await dock.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private async copyTextSafely(text: string): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard permissions may be unavailable in background/headless contexts
    }
  }

  private loadPreferDock(): boolean {
    try {
      const stored = this.storage.get<boolean>(PREFER_DOCK_STORAGE_KEY);
      return typeof stored === 'boolean' ? stored : true;
    } catch {
      return true;
    }
  }
}
