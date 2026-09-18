import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RisksService, type RiskConfig } from '../../core/rules';
import { ToastService } from '../../core/toast.service';
import { StorageService } from '../../core/storage';
import { clampAtLeast, clampMoney as sharedClampMoney, formatSpreadAlertMessage } from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { McpService } from '../../core/mcp.service';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  alertsEnabled: boolean;
}

/** Telegram chat ids are signed integers (usually 9-10 digits). Phone numbers never work. */
function isValidChatId(chatId: string): boolean {
  return /^-?\d{5,12}$/.test(chatId.trim());
}

/**
 * C4 — Risk-rules config view. Edits the safety-barrier rules and Telegram Sentinel bot credentials.
 */
@Component({
  selector: 'app-risk-rules',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, UiCard, UiPanelHeader],
  templateUrl: './risk-rules.html',
})
export class RiskRules implements OnInit {
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(StorageService);
  readonly telegramWorker = inject(TelegramWorkerService);
  private readonly binance = inject(BinanceP2pService);
  readonly mcpService = inject(McpService);

  readonly config = this.risks.config;
  readonly draft = signal<RiskConfig>({ ...this.risks.config() });

  // MCP Tool: evaluate_trade_risk
  readonly preflightTradeAmountUsdt = signal<number>(100);
  readonly preflightNetSpreadPct = signal<number>(1.25);
  readonly mcpPreflightResult = signal<{
    verdict?: string;
    reason?: string;
    ruleChecks?: unknown[];
  } | null>(null);
  readonly mcpPreflightEvaluating = signal<boolean>(false);

  // MCP Tool: calculate_delta_neutral_hedge
  readonly hedgeVesBalance = signal<number>(50000);
  readonly hedgeUsdtRefPrice = signal<number>(800);
  readonly hedgeTargetPct = signal<number>(100);
  readonly mcpHedgeResult = signal<{
    shortHedgeUsdt?: number;
    requiredShortUsdt?: number;
    recommendedInstrument?: string;
  } | null>(null);
  readonly mcpHedgeCalculating = signal<boolean>(false);

  // MCP Tool: consult_zk_market_mesh
  readonly zkCounterpartyQuery = signal<string>('');
  readonly mcpZkResult = signal<{
    blindHash?: string;
    riskScore?: number;
    recommendation?: string;
  } | null>(null);
  readonly mcpZkLoading = signal<boolean>(false);

  // MCP Tool: trigger_killswitch
  readonly killswitchChallenge = signal<string>('');
  readonly killswitchReason = signal<string>('Parada de emergencia de tesorería');
  readonly killswitchActive = signal<boolean>(false);
  readonly mcpKillswitchLoading = signal<boolean>(false);

  // Telegram Sentinel credentials (hydrated asynchronously from secure storage).
  readonly telegramToken = signal<string>('');
  readonly telegramChatId = signal<string>('');
  readonly telegramAlertsEnabled = signal<boolean>(true);
  readonly telegramPollingEnabled = signal<boolean>(false);

  ngOnInit(): void {
    void this.telegramWorker.getConfig().then((cfg) => {
      this.telegramToken.set(cfg.botToken);
      this.telegramChatId.set(cfg.chatId);
      this.telegramAlertsEnabled.set(cfg.alertsEnabled);
      this.telegramPollingEnabled.set(cfg.pollingEnabled ?? false);
    });
  }

  /** trading pair context for the spread threshold label (USDT/VES or EUR/VES). */
  readonly pair = signal<'USDT' | 'EUR'>('USDT');
  setPair(value: string): void {
    this.pair.set(value === 'EUR' ? 'EUR' : 'USDT');
  }

  readonly verdict = computed(() => this.risks.evaluate(this.risks.sampleState()));

  save(): void {
    this.risks.save({ ...this.draft() });
    this.toast.success('Parámetros de riesgo guardados correctamente.');
  }

  saveTelegramConfig(): void {
    const chatId = this.telegramChatId().trim();
    if (!isValidChatId(chatId)) {
      this.toast.warn(
        'El Chat ID debe ser un número (ej. 987654321). Un teléfono como +58... no funciona.',
      );
      return;
    }
    const config = {
      botToken: this.telegramToken().trim(),
      chatId,
      alertsEnabled: this.telegramAlertsEnabled(),
      pollingEnabled: this.telegramPollingEnabled(),
    };
    void this.telegramWorker.saveConfig(config);
    this.toast.success('Configuración de Telegram Sentinel 2.0 guardada con éxito.');
  }

  togglePolling(): void {
    // The select handler already set telegramPollingEnabled to the chosen
    // value — act on it, never negate it (negating left the worker INACTIVO
    // no matter what the user selected).
    if (this.telegramPollingEnabled()) {
      this.telegramWorker.startPolling();
    } else {
      this.telegramWorker.stopPolling();
    }
  }

  async sendTestTelegramAlert(): Promise<void> {
    const token = this.telegramToken().trim();
    const chatId = this.telegramChatId().trim();

    if (!token || !chatId) {
      this.toast.warn('Ingresa el Token del Bot y tu Chat ID para enviar alertas.');
      return;
    }

    if (!isValidChatId(chatId)) {
      this.toast.warn(
        'El Chat ID debe ser un número (ej. 987654321). Un teléfono como +58... no funciona.',
      );
      return;
    }

    // Live market data for the test alert — never ship hardcoded prices that
    // look like stale alerts (market moves, hardcoded values mislead).
    const depth = await this.binance.fetchMarketDepth('USDT', 'VES', true);
    if (!depth) {
      this.toast.warn(
        'No hay datos de mercado ahora: la alerta de prueba no se envió. Revisa conexión o abre el panel de spreads.',
      );
      return;
    }

    const testMsg = formatSpreadAlertMessage({
      pair: `${this.pair()}/VES`,
      buyPrice: depth.bestBuyPrice,
      sellPrice: depth.bestSellPrice,
      netSpreadPct: depth.spreadPct,
      bank: 'Banesco (Prueba Sentinel)',
    });

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: testMsg,
          parse_mode: 'MarkdownV2',
        }),
      });

      if (res.ok) {
        this.toast.success('¡Alerta de prueba enviada a tu Telegram con éxito!');
      } else {
        let detail = '';
        try {
          const body = (await res.json()) as { description?: string };
          detail = body?.description ?? '';
        } catch {
          // ignore unparseable response body
        }
        this.toast.error(
          detail
            ? `Telegram rechazó la petición (${detail}).`
            : 'Telegram rechazó la petición. Verifica el Token y Chat ID.',
        );
      }
    } catch {
      this.toast.info('Alerta simulada (sin conexión a internet o bloqueada por CORS).');
    }
  }

  reset(): void {
    this.risks.reset();
    this.draft.set({ ...this.risks.config() });
    this.toast.info('Reglas de riesgo restablecidas a los valores de fábrica.');
  }

  patch(p: Partial<RiskConfig>): void {
    this.draft.set({ ...this.draft(), ...p });
  }

  /** Template helpers: sanitize number-input entries before they reach the draft. */
  clampMoney(v: number): number {
    return sharedClampMoney(v);
  }
  clampCount(v: number): number {
    return Math.round(clampAtLeast(v, 1));
  }

  private readonly REASON_LABELS: Record<string, string> = {
    'api-failure': 'fallo de API',
    'daily loss cap exceeded': 'tope de pérdida diaria superado',
    'consecutive errors limit reached': 'límite de errores consecutivos alcanzado',
    'max concurrent operations reached': 'máximo de operaciones concurrentes alcanzado',
    'spread below minimum': 'spread por debajo del mínimo',
    'risk per trade exceeded': 'riesgo por operación superado',
    ok: 'dentro de límites',
  };

  decisionLabel(d: string): string {
    return d === 'ALLOW' ? 'PERMITIR' : d === 'DENY' ? 'DENEGAR' : 'PAUSAR';
  }

  async evaluatePreflightRisk(): Promise<void> {
    this.mcpPreflightEvaluating.set(true);
    try {
      const res = await this.mcpService.evaluateTradeRisk({
        tradeAmountUsdt: this.preflightTradeAmountUsdt(),
        currentCapitalUsdt: 5000,
        counterpartyScore: 98,
        fiatCurrency: 'VES',
      });
      if (res.success && res.result) {
        this.mcpPreflightResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpPreflightResult>>,
        );
        this.toast.info('Evaluación pre-flight MCP completada con éxito.');
      } else {
        this.toast.error(res.error || 'Error al evaluar riesgo pre-flight');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado en evaluateTradeRisk';
      this.toast.error(msg);
    } finally {
      this.mcpPreflightEvaluating.set(false);
    }
  }

  async calculateDeltaHedge(): Promise<void> {
    this.mcpHedgeCalculating.set(true);
    try {
      const res = await this.mcpService.calculateDeltaNeutralHedge({
        vesBalance: this.hedgeVesBalance(),
        usdtReferencePrice: this.hedgeUsdtRefPrice(),
        targetHedgePct: this.hedgeTargetPct(),
      });
      if (res.success && res.result) {
        this.mcpHedgeResult.set(res.result as NonNullable<ReturnType<typeof this.mcpHedgeResult>>);
        this.toast.info('Cálculo de cobertura delta neutral completado.');
      } else {
        this.toast.error(res.error || 'Error al calcular cobertura');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Error inesperado en calculateDeltaNeutralHedge';
      this.toast.error(msg);
    } finally {
      this.mcpHedgeCalculating.set(false);
    }
  }

  async queryZkMarketMesh(): Promise<void> {
    const raw = this.zkCounterpartyQuery().trim();
    if (!raw) {
      this.toast.warn('Ingresa un identificador o alias de contraparte.');
      return;
    }
    this.mcpZkLoading.set(true);
    try {
      const res = await this.mcpService.consultZkMarketMesh({ rawIdentifier: raw });
      if (res.success && res.result) {
        this.mcpZkResult.set(res.result as NonNullable<ReturnType<typeof this.mcpZkResult>>);
        this.toast.success('Consulta ZK Market Mesh resuelta sin divulgar identidad.');
      } else {
        this.toast.error(res.error || 'Fallo en consulta ZK');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error en consultZkMarketMesh';
      this.toast.error(msg);
    } finally {
      this.mcpZkLoading.set(false);
    }
  }

  async activateKillswitch(): Promise<void> {
    const phrase = this.killswitchChallenge().trim();
    if (phrase !== 'CONFIRMAR-FREEZE') {
      this.toast.warn('Debes escribir exactamente "CONFIRMAR-FREEZE" para activar el killswitch.');
      return;
    }
    this.mcpKillswitchLoading.set(true);
    try {
      const res = await this.mcpService.triggerKillswitch({
        reason: this.killswitchReason().trim() || 'Parada de emergencia',
        source: 'RiskRulesUI',
        humanConfirm: true,
      });
      if (res.success && res.result) {
        this.killswitchActive.set(true);
        this.patch({ apiStatus: 'down' });
        this.toast.error('🚨 KILLSWITCH ACTIVADO: Gateway en modo seguro y operaciones pausadas.');
      } else {
        this.toast.error(res.error || 'No se pudo activar el killswitch');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al invocar triggerKillswitch';
      this.toast.error(msg);
    } finally {
      this.mcpKillswitchLoading.set(false);
    }
  }

  resetKillswitch(): void {
    this.killswitchActive.set(false);
    this.killswitchChallenge.set('');
    this.patch({ apiStatus: 'ok' });
    this.toast.info('Killswitch desactivado. Gateway restablecido a estado OK.');
  }

  reasonLabel(r: string): string {
    return this.REASON_LABELS[r] ?? r;
  }
}
