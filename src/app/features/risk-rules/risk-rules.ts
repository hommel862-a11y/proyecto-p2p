import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RisksService, type RiskConfig } from '../../core/rules';
import { ToastService } from '../../core/toast.service';
import { StorageService } from '../../core/storage';
import { clampAtLeast, clampMoney as sharedClampMoney, formatSpreadAlertMessage } from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';

const TELEGRAM_KEY = 'p2p.telegram_config';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  alertsEnabled: boolean;
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
export class RiskRules {
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(StorageService);

  readonly config = this.risks.config;
  readonly draft = signal<RiskConfig>({ ...this.risks.config() });

  // Telegram Sentinel credentials
  private readonly savedTelegram = this.storage.get<TelegramConfig>(TELEGRAM_KEY) || {
    botToken: '',
    chatId: '',
    alertsEnabled: true,
  };

  readonly telegramToken = signal<string>(this.savedTelegram.botToken);
  readonly telegramChatId = signal<string>(this.savedTelegram.chatId);
  readonly telegramAlertsEnabled = signal<boolean>(this.savedTelegram.alertsEnabled);

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
    const config: TelegramConfig = {
      botToken: this.telegramToken().trim(),
      chatId: this.telegramChatId().trim(),
      alertsEnabled: this.telegramAlertsEnabled(),
    };
    this.storage.set(TELEGRAM_KEY, config);
    this.toast.success('Configuración de Telegram Sentinel guardada con éxito.');
  }

  async sendTestTelegramAlert(): Promise<void> {
    const token = this.telegramToken().trim();
    const chatId = this.telegramChatId().trim();

    if (!token || !chatId) {
      this.toast.warn('Ingresa el Token del Bot y tu Chat ID para enviar alertas.');
      return;
    }

    const testMsg = formatSpreadAlertMessage({
      pair: `${this.pair()}/VES`,
      buyPrice: 800.0,
      sellPrice: 825.0,
      netSpreadPct: 3.12,
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
        this.toast.error('Telegram rechazó la petición. Verifica el Token y Chat ID.');
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
