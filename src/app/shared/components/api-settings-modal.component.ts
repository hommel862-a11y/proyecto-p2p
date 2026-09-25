import { Component, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-api-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="api-modal-backdrop"
      role="button"
      tabindex="0"
      (click)="$event.target === $event.currentTarget && close.emit()"
      (keydown.escape)="close.emit()"
      aria-label="Cerrar ventana de conexiones y APIs"
    >
      <div
        class="api-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-dialog-title"
        tabindex="-1"
      >
        <div class="dialog-header">
          <div class="header-title">
            <span class="header-icon" aria-hidden="true">🌐</span>
            <div>
              <h3 id="api-dialog-title">Conexiones & APIs Móviles</h3>
              <p>Configuración soberana de proveedores de mercado y mensajería</p>
            </div>
          </div>
          <button
            type="button"
            class="btn-close"
            (click)="close.emit()"
            aria-label="Cerrar modal"
          >
            &times;
          </button>
        </div>

        <div class="dialog-body">
          <!-- 1. CotizaVe API -->
          <section class="api-card">
            <div class="api-card-head">
              <div class="api-title-row">
                <span class="api-badge" [class.badge-active]="cotizave.apiKey()">
                  {{ cotizave.apiKey() ? '🟢 ACTIVO' : '🟡 PENDIENTE' }}
                </span>
                <strong>CotizaVe (Tasas Oficiales & Paralelo)</strong>
              </div>
              <span class="api-desc">
                Provee tasas BCV, EnParaleloVzla y DolarToday para calcular márgenes y gaps.
              </span>
            </div>
            <div class="api-input-group">
              <label for="cotizave-key-input">API Key Personal</label>
              <div class="input-with-action">
                <input
                  id="cotizave-key-input"
                  [type]="showCotizaveKey() ? 'text' : 'password'"
                  [value]="cotizaveKeyInput()"
                  (input)="onCotizaveInput($event)"
                  placeholder="cz_live_..."
                  class="font-mono form-control"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="btn-icon-action"
                  (click)="showCotizaveKey.set(!showCotizaveKey())"
                  [title]="showCotizaveKey() ? 'Ocultar clave' : 'Mostrar clave'"
                >
                  {{ showCotizaveKey() ? '👁️‍🗨️' : '👁️' }}
                </button>
              </div>
            </div>
            <div class="api-actions-row">
              <button
                type="button"
                class="btn-save"
                (click)="saveCotizave()"
                [disabled]="cotizave.loading()"
              >
                Guardar Clave
              </button>
              <button
                type="button"
                class="btn-test"
                (click)="testCotizave()"
                [disabled]="!cotizave.apiKey() || cotizave.loading()"
              >
                {{ cotizave.loading() ? 'Verificando...' : '⚡ Probar Conexión' }}
              </button>
            </div>
          </section>

          <!-- 2. Binance P2P Engine -->
          <section class="api-card">
            <div class="api-card-head">
              <div class="api-title-row">
                <span class="api-badge badge-active">🟢 NATIVO ANDROID</span>
                <strong>Binance P2P Radar</strong>
              </div>
              <span class="api-desc">
                En Android se utiliza el cliente HTTP nativo (CapacitorHttp) para evitar bloqueos CORS.
              </span>
            </div>

            <div class="proxy-toggle-row">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  [checked]="binance.usePublicCorsProxy()"
                  (change)="onProxyToggle($event)"
                />
                <span>Habilitar Proxy de Respaldo (para redes con bloqueo DNS)</span>
              </label>
            </div>

            @if (binance.usePublicCorsProxy()) {
              <div class="api-input-group">
                <label for="custom-proxy-input">URL de Proxy Personal (Opcional)</label>
                <input
                  id="custom-proxy-input"
                  type="text"
                  [value]="binance.customProxyUrl()"
                  (input)="onProxyUrlInput($event)"
                  placeholder="https://tu-proxy-cors.com/proxy"
                  class="font-mono form-control"
                />
              </div>
            }

            <div class="api-actions-row">
              <button
                type="button"
                class="btn-test"
                (click)="testBinance()"
                [disabled]="binance.loading()"
              >
                {{ binance.loading() ? 'Consultando...' : '⚡ Consultar Radar Binance' }}
              </button>
            </div>
          </section>

          <!-- 3. Telegram Alertas y Sentinel -->
          <section class="api-card">
            <div class="api-card-head">
              <div class="api-title-row">
                <span class="api-badge" [class.badge-active]="telegram.config().botToken">
                  {{ telegram.config().botToken ? '🟢 CONFIGURADO' : '⚪ INACTIVO' }}
                </span>
                <strong>Telegram Bot Alertas</strong>
              </div>
              <span class="api-desc">
                Envía notificaciones de comprobantes, alertas de fraude y resumen de jornada.
              </span>
            </div>

            <div class="api-input-group">
              <label for="telegram-token-input">Bot Token (BotFather)</label>
              <input
                id="telegram-token-input"
                type="password"
                [value]="telegramTokenInput()"
                (input)="onTelegramTokenInput($event)"
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                class="font-mono form-control"
              />
            </div>

            <div class="api-input-group">
              <label for="telegram-chat-input">Chat ID Personal</label>
              <input
                id="telegram-chat-input"
                type="text"
                [value]="telegramChatIdInput()"
                (input)="onTelegramChatInput($event)"
                placeholder="Ej. 987654321"
                class="font-mono form-control"
              />
            </div>

            <div class="api-actions-row">
              <button type="button" class="btn-save" (click)="saveTelegram()">
                Guardar Telegram
              </button>
              <button
                type="button"
                class="btn-test"
                (click)="testTelegram()"
                [disabled]="!telegram.config().botToken"
              >
                📤 Probar Alerta
              </button>
            </div>
          </section>
        </div>

        <div class="dialog-footer">
          <button type="button" class="btn-primary-close" (click)="close.emit()">
            Listo
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .api-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(4, 7, 13, 0.78);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 1200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: fadeIn 0.2s ease-out;
      }

      .api-modal-dialog {
        background: var(--panel);
        border: 1px solid var(--line);
        box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.7), 0 0 30px rgba(216, 180, 92, 0.08);
        border-radius: var(--radius-lg, 16px);
        width: 100%;
        max-width: 580px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.02);
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .header-icon {
        font-size: 1.5rem;
      }
      .header-title h3 {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 600;
        color: var(--text);
      }
      .header-title p {
        margin: 2px 0 0;
        font-size: 0.78rem;
        color: var(--muted);
      }

      .btn-close {
        background: transparent;
        border: none;
        color: var(--muted);
        font-size: 1.5rem;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
        border-radius: 6px;
      }
      .btn-close:hover {
        color: var(--text);
        background: rgba(255, 255, 255, 0.08);
      }

      .dialog-body {
        padding: 20px 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .api-card {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .api-card-head {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .api-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.95rem;
        color: var(--text);
      }
      .api-badge {
        font-size: 0.65rem;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--muted);
      }
      .api-badge.badge-active {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      .api-desc {
        font-size: 0.75rem;
        color: var(--muted);
        line-height: 1.4;
      }

      .api-input-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .api-input-group label {
        font-size: 0.75rem;
        color: var(--muted);
        font-weight: 500;
      }

      .input-with-action {
        display: flex;
        gap: 8px;
      }

      .form-control {
        width: 100%;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid var(--line);
        color: var(--text);
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.85rem;
        min-height: 44px;
      }
      .form-control:focus {
        border-color: var(--gold);
        outline: none;
      }

      .btn-icon-action {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: 8px;
        padding: 0 12px;
        min-height: 44px;
        cursor: pointer;
      }

      .proxy-toggle-row {
        margin: 4px 0;
      }
      .toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
        color: var(--text);
        cursor: pointer;
      }
      .toggle-label input {
        width: 18px;
        height: 18px;
      }

      .api-actions-row {
        display: flex;
        gap: 10px;
        margin-top: 4px;
        flex-wrap: wrap;
      }

      .btn-save,
      .btn-test {
        padding: 9px 16px;
        border-radius: 8px;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .btn-save {
        background: rgba(216, 180, 92, 0.15);
        border: 1px solid var(--gold);
        color: var(--gold);
      }
      .btn-save:hover {
        background: rgba(216, 180, 92, 0.25);
      }

      .btn-test {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--line);
        color: var(--text);
      }
      .btn-test:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
      }
      .btn-test:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .dialog-footer {
        padding: 14px 24px;
        border-top: 1px solid var(--line);
        display: flex;
        justify-content: flex-end;
        background: rgba(255, 255, 255, 0.02);
      }

      .btn-primary-close {
        background: var(--gold);
        color: #0b0e14;
        border: none;
        border-radius: 8px;
        padding: 10px 24px;
        font-size: 0.88rem;
        font-weight: 700;
        cursor: pointer;
        min-height: 44px;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `,
  ],
})
export class ApiSettingsModalComponent {
  readonly cotizave = inject(CotizaveService);
  readonly binance = inject(BinanceP2pService);
  readonly telegram = inject(TelegramWorkerService);
  private readonly toast = inject(ToastService);

  readonly close = output<void>();

  readonly showCotizaveKey = signal<boolean>(false);
  readonly cotizaveKeyInput = signal<string>(this.cotizave.apiKey());
  readonly telegramTokenInput = signal<string>(this.telegram.config().botToken || '');
  readonly telegramChatIdInput = signal<string>(this.telegram.config().chatId || '');

  onCotizaveInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.cotizaveKeyInput.set(val);
  }

  saveCotizave(): void {
    const key = this.cotizaveKeyInput().trim();
    this.cotizave.setApiKey(key);
  }

  async testCotizave(): Promise<void> {
    try {
      await this.cotizave.fetchRates('rates');
      this.toast.success('Conexión con CotizaVe exitosa.', 'API CotizaVe');
    } catch {
      this.toast.error('Error al consultar CotizaVe. Verifica tu API Key.', 'API CotizaVe');
    }
  }

  onProxyToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.binance.setUsePublicProxy(checked);
  }

  onProxyUrlInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.binance.customProxyUrl.set(val);
  }

  async testBinance(): Promise<void> {
    try {
      const res = await this.binance.fetchMarketDepth('USDT', 'VES');
      if (res) {
        this.toast.success(
          `Radar Binance activo: ${res.buyOffers.length} compras / ${res.sellOffers.length} ventas`,
          'Binance P2P',
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al conectar con Binance P2P';
      this.toast.error(msg, 'Binance P2P');
    }
  }

  onTelegramTokenInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.telegramTokenInput.set(val);
  }

  onTelegramChatInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.telegramChatIdInput.set(val);
  }

  saveTelegram(): void {
    const token = this.telegramTokenInput().trim();
    const chatId = this.telegramChatIdInput().trim();
    this.telegram.saveConfig({
      ...this.telegram.config(),
      botToken: token,
      chatId,
    });
    this.toast.success('Configuración de Telegram guardada.', 'Telegram');
  }

  async testTelegram(): Promise<void> {
    try {
      const bot = await this.telegram.getBotInfo(this.telegram.config().botToken);
      if (bot) {
        this.toast.success(`Bot verificado: @${bot.username}`, 'Telegram');
      } else {
        this.toast.error('Token de Telegram inválido.', 'Telegram');
      }
    } catch {
      this.toast.error('Error al contactar API de Telegram.', 'Telegram');
    }
  }
}
