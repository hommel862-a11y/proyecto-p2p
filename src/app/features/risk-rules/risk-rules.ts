import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RisksService, type RiskConfig } from '../../core/rules';
import { ToastService } from '../../core/toast.service';
import { StorageService } from '../../core/storage';
import { clampAtLeast, clampMoney as sharedClampMoney, formatSpreadAlertMessage } from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';

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
  imports: [FormsModule, UiCard, UiPanelHeader],
  templateUrl: './risk-rules.html',
})
export class RiskRules implements OnInit {
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(StorageService);
  readonly telegramWorker = inject(TelegramWorkerService);
  private readonly binance = inject(BinanceP2pService);

  readonly config = this.risks.config;
  readonly draft = signal<RiskConfig>({ ...this.risks.config() });

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

  reasonLabel(r: string): string {
    return this.REASON_LABELS[r] ?? r;
  }
}
