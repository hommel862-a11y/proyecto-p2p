import { Component, inject, signal, output, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { normalizeCotizaveApiKey } from '@p2p/core';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { BinanceAccountProfileService } from '../../core/binance-account-profile.service';
import { ToastService } from '../../core/toast.service';
import { StorageService } from '../../core/storage';

export interface AiModelOption {
  id: string;
  label: string;
  badge?: string;
  description?: string;
}

export const AI_MODELS_BY_PROVIDER: Record<string, AiModelOption[]> = {
  gemini: [
    { id: 'gemini-3.8-flash', label: '⚡ Gemini 3.8 Flash (Recomendado - Agéntico & Multimodal)', badge: 'RECOMENDADO' },
    { id: 'gemini-4-argon', label: '🧠 Gemini 4 Argon (Razonamiento Frontier Rápido)', badge: 'FRONTIER' },
    { id: 'gemini-4-carbon', label: '💎 Gemini 4 Carbon (Máxima Profundidad)', badge: 'PRO' },
    { id: 'gemini-3.5-flash-lite', label: '⚖️ Gemini 3.5 Flash Lite (Alto Rendimiento / Bajo Costo)', badge: 'ESTABLE' },
    { id: 'gemini-3.1-flash-lite', label: '🌱 Gemini 3.1 Flash Lite (Ultra Rápido)', badge: 'LITE' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (v2)', badge: 'RECOMENDADO' },
    { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (Híbrido)', badge: 'HÍBRIDO' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Rápido)', badge: 'RÁPIDO' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (Omnimodal)', badge: 'RECOMENDADO' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Económico)', badge: 'MINI' },
    { id: 'o3-mini', label: 'o3-mini (Razonamiento Lógico)', badge: 'REASONING' },
    { id: 'o1', label: 'o1 (Máximo Razonamiento)', badge: 'REASONING' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek-V3 (Conversacional)', badge: 'RECOMENDADO' },
    { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (Cadena de Pensamiento)', badge: 'REASONING' },
  ],
  qwen: [
    { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct', badge: 'RECOMENDADO' },
    { id: 'qwen/qwen-2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', badge: 'CÓDIGO' },
  ],
};

@Component({
  selector: 'app-api-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="api-modal-backdrop"
      role="button"
      tabindex="0"
      (click)="$event.target === $event.currentTarget && modalClose.emit()"
      (keydown.escape)="modalClose.emit()"
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
            (click)="modalClose.emit()"
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
                [disabled]="(!cotizave.apiKey() && !cotizaveKeyInput().trim()) || cotizave.loading()"
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

            <div style="border-top: 1px solid var(--line); padding-top: 12px; margin-top: 6px; display: flex; flex-direction: column; gap: 10px;">
              <div class="api-title-row">
                <span class="api-badge" [class.badge-active]="binanceProfile.vaultStatus().hasCredentials">
                  {{ binanceProfile.vaultStatus().hasCredentials ? '🔒 BÓVEDA CIFRADA' : '⚪ SIN CLAVES SAPI' }}
                </span>
                <strong>Nivel de Cuenta P2P &amp; Bóveda Merchant SAPI</strong>
              </div>
              <span class="api-desc">
                @if (binanceProfile.isDesktopVaultAvailable()) {
                  Claves HMAC-SHA256 y URL de Proxy se cifran localmente en SQLite + safeStorage (nunca se exponen en localStorage).
                } @else {
                  Modo web: solo se guarda el nivel Maker y chequeo KYC; las claves SAPI requieren Escritorio Electron.
                }
              </span>

              <div class="api-input-group">
                <label for="binance-merchant-tier">Nivel Maker / Merchant</label>
                <select
                  id="binance-merchant-tier"
                  class="form-control"
                  [value]="binanceProfile.merchantLevel()"
                  (change)="onMerchantLevelChange($event)"
                >
                  <option value="STANDARD">STANDARD (Solo KYC · 0.25% · Portal Asistido)</option>
                  <option value="BRONZE">BRONZE Merchant (0.20% · Escritura SAPI)</option>
                  <option value="SILVER">SILVER Merchant (0.175% · Escritura SAPI)</option>
                  <option value="GOLD">GOLD Merchant (0.125% · Escritura SAPI)</option>
                </select>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px;">
                <div class="api-input-group">
                  <label for="binance-api-key-input">Binance API Key</label>
                  <input
                    id="binance-api-key-input"
                    type="password"
                    [value]="binanceApiKeyInput()"
                    (input)="binanceApiKeyInput.set($any($event.target).value)"
                    [placeholder]="binanceProfile.vaultStatus().maskedApiKey || 'API Key HMAC-SHA256'"
                    class="font-mono form-control"
                  />
                </div>
                <div class="api-input-group">
                  <label for="binance-api-secret-input">Binance API Secret</label>
                  <input
                    id="binance-api-secret-input"
                    type="password"
                    [value]="binanceApiSecretInput()"
                    (input)="binanceApiSecretInput.set($any($event.target).value)"
                    placeholder="Dejar vacío para conservar el actual"
                    class="font-mono form-control"
                  />
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
                <div class="api-input-group">
                  <label for="binance-proxy-url-input">Proxy IP Estática SAPI (Opcional)</label>
                  <input
                    id="binance-proxy-url-input"
                    type="password"
                    [value]="binanceProxyUrlInput()"
                    (input)="binanceProxyUrlInput.set($any($event.target).value)"
                    [placeholder]="binanceProfile.vaultStatus().redactedProxyHost || 'https://user:pass@ip-fija:8443'"
                    class="font-mono form-control"
                  />
                </div>
                <div class="api-input-group">
                  <label for="binance-age-days-input">Antigüedad Cuenta (días)</label>
                  <input
                    id="binance-age-days-input"
                    type="number"
                    min="0"
                    [value]="binanceAccountAgeInput()"
                    (input)="binanceAccountAgeInput.set($any($event.target).value)"
                    placeholder="Ej. 90"
                    class="font-mono form-control"
                  />
                </div>
              </div>

              <label class="toggle-label">
                <input
                  type="checkbox"
                  [checked]="binanceProfile.vaultStatus().hasKycAnd2fa"
                  (change)="onKyc2faToggle($event)"
                />
                <span>Cuenta con KYC Verificado + 2FA Activo</span>
              </label>

              <div class="api-actions-row">
                <button type="button" class="btn-save" (click)="saveBinanceVault()">
                  💾 Guardar Bóveda Binance
                </button>
                <button
                  type="button"
                  class="btn-test"
                  (click)="auditBinanceKycAndSapi()"
                  [disabled]="binanceProfile.syncing()"
                >
                  {{ binanceProfile.syncing() ? '⏳ Auditando...' : '🔍 Probar SAPI & Auditar 5 Candados KYC' }}
                </button>
                @if (binanceProfile.vaultStatus().hasCredentials || binanceProfile.vaultStatus().hasProxyUrl) {
                  <button type="button" class="btn-icon-action" (click)="clearBinanceVault()">
                    🗑️ Limpiar Claves
                  </button>
                }
              </div>

              @if (binanceProfile.syncedOrders().length > 0 || binanceProfile.lastSyncError()) {
                <div class="api-desc" style="font-size: 0.72rem;">
                  @if (binanceProfile.lastSyncError(); as syncErr) {
                    <span style="color: #fca5a5;">⚠️ {{ syncErr }}</span>
                  } @else {
                    <span>
                      Órdenes C2C leídas: <strong>{{ binanceProfile.syncedOrders().length }}</strong> ·
                      Veredicto 5 Candados KYC:
                      <strong>
                        {{
                          binanceProfile.kycEligibility().eligible === true
                            ? '✅ APTO MAKER'
                            : binanceProfile.kycEligibility().eligible === false
                              ? '🛑 BLOQUEADO (' + binanceProfile.kycEligibility().failedGates.length + ')'
                              : '🟡 PARCIAL'
                        }}
                      </strong>
                    </span>
                  }
                </div>
              }
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

          <!-- 4. Universal AI Gateway & Copilot -->
          <section class="api-card">
            <div class="api-card-head">
              <div class="api-title-row">
                <span class="api-badge" [class.badge-active]="hasActiveAiKey()">
                  {{ hasActiveAiKey() ? '🟢 ACTIVO' : '🟡 PENDIENTE' }}
                </span>
                <strong>Universal AI Gateway (Copiloto P2P)</strong>
              </div>
              <span class="api-desc">
                Cerebro multi-proveedor: Google Gemini (con Búsqueda Web en tiempo real), Anthropic Claude, OpenAI, DeepSeek y Qwen.
              </span>
            </div>

            <div class="api-input-group">
              <label for="ai-provider-select">Proveedor de Inteligencia Artificial</label>
              <select
                id="ai-provider-select"
                [value]="selectedAiProvider()"
                (change)="onProviderChange($event)"
                class="font-mono form-control"
              >
                <option value="gemini">Google Gemini (Gemini 3.8 / Pro / Flash) [Grounding Web]</option>
                <option value="anthropic">Anthropic (Claude 3.5 Sonnet / 3.7)</option>
                <option value="openai">OpenAI (ChatGPT / GPT-4o / o3)</option>
                <option value="deepseek">DeepSeek (DeepSeek-V3 / R1)</option>
                <option value="qwen">Qwen 2.5 (OpenRouter / Local)</option>
              </select>
            </div>

            <div class="api-input-group">
              <label for="ai-model-select">Modelo de Inteligencia Artificial (Selector Soberano)</label>
              <select
                id="ai-model-select"
                [value]="selectedAiModel()"
                (change)="onModelChange($event)"
                class="font-mono form-control"
              >
                @for (m of currentAvailableModels(); track m.id) {
                  <option [value]="m.id">{{ m.label }}</option>
                }
                <option value="custom">✏️ Otro modelo (Personalizado)...</option>
              </select>
            </div>

            @if (isCustomModel()) {
              <div class="api-input-group">
                <label for="custom-model-input">ID del Modelo Personalizado</label>
                <input
                  id="custom-model-input"
                  type="text"
                  [value]="customModelInput()"
                  (input)="onCustomModelInput($event)"
                  placeholder="ej. gemini-3.8-flash, o3-mini, custom-model-id"
                  class="font-mono form-control"
                />
              </div>
            }

            <div class="api-input-group">
              <label for="gemini-key-input">API Key de {{ getProviderDisplayName() }}</label>
              <div class="input-with-action">
                <input
                  id="gemini-key-input"
                  [type]="showGeminiKey() ? 'text' : 'password'"
                  [value]="geminiKeyInput()"
                  (input)="onGeminiKeyInput($event)"
                  [placeholder]="getProviderKeyPlaceholder()"
                  class="font-mono form-control"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="btn-icon-action"
                  (click)="showGeminiKey.set(!showGeminiKey())"
                  [title]="showGeminiKey() ? 'Ocultar clave' : 'Mostrar clave'"
                >
                  {{ showGeminiKey() ? '👁️‍🗨️' : '👁️' }}
                </button>
              </div>
            </div>

            <div class="api-actions-row">
              <button
                type="button"
                class="btn-save"
                (click)="saveGemini()"
                [disabled]="isTestingGemini()"
              >
                Guardar Clave
              </button>
              <button
                type="button"
                class="btn-test"
                (click)="testGemini()"
                [disabled]="!geminiKeyInput().trim() || isTestingGemini()"
              >
                {{ isTestingGemini() ? 'Verificando...' : '🧠 Probar Conexión' }}
              </button>
            </div>
          </section>
        </div>

        <div class="dialog-footer">
          <button type="button" class="btn-primary-close" (click)="modalClose.emit()">
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
  readonly binanceProfile = inject(BinanceAccountProfileService);
  readonly telegram = inject(TelegramWorkerService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  readonly modalClose = output<void>();

  readonly binanceApiKeyInput = signal<string>('');
  readonly binanceApiSecretInput = signal<string>('');
  readonly binanceProxyUrlInput = signal<string>('');
  readonly binanceAccountAgeInput = signal<string>(
    this.binanceProfile.vaultStatus().accountAgeDaysOverride !== null
      ? String(this.binanceProfile.vaultStatus().accountAgeDaysOverride)
      : '',
  );

  readonly showCotizaveKey = signal<boolean>(false);
  readonly cotizaveKeyInput = signal<string>(this.cotizave.apiKey());
  private cotizaveKeyDirty = false;
  readonly telegramTokenInput = signal<string>(this.telegram.config().botToken || '');
  readonly telegramChatIdInput = signal<string>(this.telegram.config().chatId || '');

  constructor() {
    effect(() => {
      const hydratedKey = this.cotizave.apiKey();
      if (!this.cotizaveKeyDirty) {
        this.cotizaveKeyInput.set(hydratedKey);
      }
    });
  }

  readonly selectedAiProvider = signal<string>(
    this.storage.get<string>('p2p.ai.provider') || 'gemini',
  );
  readonly selectedAiModel = signal<string>(
    this.storage.get<string>('p2p.ai.model') ||
      this.storage.get<string>(`p2p.ai.model.${this.storage.get<string>('p2p.ai.provider') || 'gemini'}`) ||
      'gemini-3.8-flash',
  );
  readonly customModelInput = signal<string>('');

  readonly currentAvailableModels = computed<AiModelOption[]>(() => {
    return AI_MODELS_BY_PROVIDER[this.selectedAiProvider()] || [];
  });

  readonly isCustomModel = computed<boolean>(() => {
    const current = this.selectedAiModel();
    if (current === 'custom') return true;
    const known = this.currentAvailableModels().map((m) => m.id);
    return !known.includes(current) && current.trim().length > 0;
  });

  readonly showGeminiKey = signal<boolean>(false);
  readonly geminiKeyInput = signal<string>(
    this.storage.get<string>(`p2p.ai.key.${this.storage.get<string>('p2p.ai.provider') || 'gemini'}`) ||
      this.storage.get<string>('p2p.gemini.apiKey') ||
      '',
  );
  readonly hasGeminiKey = computed<boolean>(() => !!this.storage.get<string>('p2p.gemini.apiKey'));
  readonly hasActiveAiKey = computed<boolean>(() => {
    const key = this.geminiKeyInput().trim();
    if (key) return true;
    const provider = this.selectedAiProvider();
    return Boolean(
      this.storage.get<string>(`p2p.ai.key.${provider}`) ||
        (provider === 'gemini' && this.storage.get<string>('p2p.gemini.apiKey')),
    );
  });
  readonly isTestingGemini = signal<boolean>(false);

  onCotizaveInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.cotizaveKeyDirty = true;
    this.cotizaveKeyInput.set(val);
  }

  saveCotizave(): void {
    const key = normalizeCotizaveApiKey(this.cotizaveKeyInput());
    this.cotizaveKeyDirty = false;
    this.cotizaveKeyInput.set(key);
    this.cotizave.setApiKey(key);
  }

  async testCotizave(): Promise<void> {
    const pendingKey = normalizeCotizaveApiKey(this.cotizaveKeyInput());
    if (this.cotizaveKeyDirty || pendingKey !== this.cotizave.apiKey()) {
      this.saveCotizave();
    }
    if (!this.cotizave.apiKey()) {
      this.toast.error('Ingresa una API Key de CotizaVe antes de probar la conexión.', 'API CotizaVe');
      return;
    }
    try {
      await this.cotizave.fetchRates('rates');
      const err = this.cotizave.error?.() ?? null;
      const rates = this.cotizave.ratesByMarket?.() ?? {};
      if (err || Object.keys(rates).length === 0) {
        if (!err) {
          this.toast.error('Error al consultar CotizaVe. Verifica tu API Key.', 'API CotizaVe');
        }
        return;
      }
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

  async onMerchantLevelChange(event: Event): Promise<void> {
    const level = (event.target as HTMLSelectElement).value as 'STANDARD' | 'BRONZE' | 'SILVER' | 'GOLD';
    await this.binanceProfile.setMerchantLevel(level);
  }

  async onKyc2faToggle(event: Event): Promise<void> {
    const checked = (event.target as HTMLInputElement).checked;
    await this.binanceProfile.saveConfig({ hasKycAnd2fa: checked });
  }

  async saveBinanceVault(): Promise<void> {
    const rawAge = this.binanceAccountAgeInput().trim();
    const ageNum = rawAge.length > 0 ? Number(rawAge) : null;
    try {
      await this.binanceProfile.saveConfig({
        ...(this.binanceApiKeyInput().trim() ? { apiKey: this.binanceApiKeyInput().trim() } : {}),
        ...(this.binanceApiSecretInput().trim() ? { apiSecret: this.binanceApiSecretInput().trim() } : {}),
        ...(this.binanceProxyUrlInput().trim() ? { merchantProxyUrl: this.binanceProxyUrlInput().trim() } : {}),
        merchantLevel: this.binanceProfile.merchantLevel(),
        accountAgeDaysOverride: ageNum !== null && Number.isFinite(ageNum) && ageNum >= 0 ? Math.trunc(ageNum) : null,
      });
      this.binanceApiKeyInput.set('');
      this.binanceApiSecretInput.set('');
      this.binanceProxyUrlInput.set('');
      this.toast.success('Configuración Binance P2P guardada en bóveda.', 'Binance SAPI');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar en bóveda';
      this.toast.error(msg, 'Binance SAPI');
    }
  }

  async clearBinanceVault(): Promise<void> {
    await this.binanceProfile.clearConfig();
    this.binanceApiKeyInput.set('');
    this.binanceApiSecretInput.set('');
    this.binanceProxyUrlInput.set('');
    this.binanceAccountAgeInput.set('');
    this.toast.info('Credenciales Binance eliminadas de la bóveda.', 'Binance SAPI');
  }

  async auditBinanceKycAndSapi(): Promise<void> {
    const orders = await this.binanceProfile.syncC2cOrders({
      ...(this.binanceApiKeyInput().trim() ? { apiKey: this.binanceApiKeyInput().trim() } : {}),
      ...(this.binanceApiSecretInput().trim() ? { apiSecret: this.binanceApiSecretInput().trim() } : {}),
    });
    if (orders.length > 0 || !this.binanceProfile.lastSyncError()) {
      const elig = this.binanceProfile.kycEligibility();
      this.toast.success(
        `SAPI C2C verificado (${orders.length} órdenes). Estado KYC Maker: ${elig.eligible === true ? 'APTO' : elig.eligible === false ? 'BLOQUEADO' : 'PARCIAL'}.`,
        'Auditoría Binance KYC',
      );
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

  onProviderChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const provider = target.value;
    this.selectedAiProvider.set(provider);
    this.storage.set('p2p.ai.provider', provider);
    const existingKey =
      this.storage.get<string>(`p2p.ai.key.${provider}`) ||
      (provider === 'gemini' ? this.storage.get<string>('p2p.gemini.apiKey') || '' : '');
    this.geminiKeyInput.set(existingKey);

    const available = AI_MODELS_BY_PROVIDER[provider] || [];
    const defaultModel = available[0]?.id || 'gemini-3.7-flash';
    const savedModel = this.storage.get<string>(`p2p.ai.model.${provider}`) || defaultModel;
    this.selectedAiModel.set(savedModel);
    this.storage.set('p2p.ai.model', savedModel);

    if (typeof window !== 'undefined') {
      const win = window as any;
      const electronCopilot = win.electron?.copilot || win.p2p?.copilot || win.electronAPI?.copilot;
      if (electronCopilot?.setProviderConfig) {
        void electronCopilot.setProviderConfig({
          provider,
          model: savedModel,
          apiKey: existingKey || undefined,
        });
      }
    }
  }

  onModelChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const model = target.value;
    if (model === 'custom') {
      this.selectedAiModel.set('custom');
    } else {
      this.selectedAiModel.set(model);
      this.storage.set('p2p.ai.model', model);
      this.storage.set(`p2p.ai.model.${this.selectedAiProvider()}`, model);
      this.syncProviderConfig();
    }
  }

  onCustomModelInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value.trim();
    this.customModelInput.set(val);
    if (val) {
      this.storage.set('p2p.ai.model', val);
      this.storage.set(`p2p.ai.model.${this.selectedAiProvider()}`, val);
      this.syncProviderConfig();
    }
  }

  getEffectiveModel(): string {
    const current = this.selectedAiModel();
    if (current === 'custom') {
      return this.customModelInput().trim() || 'gemini-3.7-flash';
    }
    return current || 'gemini-3.7-flash';
  }

  private syncProviderConfig(): void {
    const provider = this.selectedAiProvider();
    const model = this.getEffectiveModel();
    const key = this.geminiKeyInput().trim();
    if (typeof window !== 'undefined') {
      const win = window as any;
      const electronCopilot = win.electron?.copilot || win.p2p?.copilot || win.electronAPI?.copilot;
      if (electronCopilot?.setProviderConfig) {
        void electronCopilot.setProviderConfig({
          provider,
          model,
          apiKey: key || undefined,
        });
      }
    }
  }

  getProviderDisplayName(): string {
    switch (this.selectedAiProvider()) {
      case 'openai':
        return 'OpenAI (ChatGPT)';
      case 'anthropic':
        return 'Anthropic Claude';
      case 'deepseek':
        return 'DeepSeek AI';
      case 'qwen':
        return 'Qwen 2.5';
      case 'gemini':
      default:
        return 'Google Gemini';
    }
  }

  getProviderKeyPlaceholder(): string {
    switch (this.selectedAiProvider()) {
      case 'openai':
        return 'sk-proj-...';
      case 'anthropic':
        return 'sk-ant-...';
      case 'deepseek':
        return 'sk-...';
      case 'qwen':
        return 'sk-...';
      case 'gemini':
      default:
        return 'AIzaSy...';
    }
  }

  onGeminiKeyInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.geminiKeyInput.set(val);
  }

  async saveGemini(): Promise<void> {
    const provider = this.selectedAiProvider();
    const key = this.geminiKeyInput().trim();
    const model = this.getEffectiveModel();
    this.storage.set('p2p.ai.provider', provider);
    this.storage.set(`p2p.ai.key.${provider}`, key);
    this.storage.set('p2p.ai.model', model);
    this.storage.set(`p2p.ai.model.${provider}`, model);

    if (provider === 'gemini') {
      this.storage.set('p2p.gemini.apiKey', key);
    }

    if (typeof window !== 'undefined') {
      const win = window as any;
      const electronCopilot = win.electron?.copilot || win.p2p?.copilot || win.electronAPI?.copilot;
      if (electronCopilot) {
        if (electronCopilot.setProviderConfig) {
          await electronCopilot.setProviderConfig({ provider, model, apiKey: key });
        }
        if (provider === 'gemini' && electronCopilot.setApiKey) {
          await electronCopilot.setApiKey({ apiKey: key });
        }
      }
    }

    if (provider === 'gemini') {
      this.toast.success('Clave de Google Gemini guardada.', 'Gemini AI');
    } else {
      this.toast.success(`Clave de ${this.getProviderDisplayName()} guardada.`, 'Cerebro IA');
    }
  }

  async testGemini(): Promise<void> {
    const provider = this.selectedAiProvider();
    const model = this.getEffectiveModel();
    const key =
      this.geminiKeyInput().trim() ||
      this.storage.get<string>(`p2p.ai.key.${provider}`) ||
      (provider === 'gemini' ? this.storage.get<string>('p2p.gemini.apiKey') : '');

    if (!key) {
      this.toast.warn(`Ingresá una API Key para ${this.getProviderDisplayName()}.`, 'Cerebro IA');
      return;
    }

    this.isTestingGemini.set(true);
    try {
      if (typeof window !== 'undefined') {
        const win = window as any;
        const electronCopilot = win.electron?.copilot || win.p2p?.copilot || win.electronAPI?.copilot;

        if (electronCopilot?.testConnection) {
          const res = await electronCopilot.testConnection({ provider, model, apiKey: key });
          if (res?.success) {
            this.toast.success(
              `${this.getProviderDisplayName()} verificado y enlazado (${res.model || model}).`,
              'Cerebro IA',
            );
            return;
          } else {
            this.toast.error(
              `Error al conectar con ${this.getProviderDisplayName()}: ${res?.error || res?.message || 'Falló la conexión'}`,
              'Cerebro IA',
            );
            return;
          }
        }
      }

      if (provider === 'gemini') {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
          },
        );

        if (res.ok) {
          this.toast.success('Google Gemini verificado y listo (0 tokens consumidos).', 'Gemini AI');
        } else {
          const errData = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          const lastErrMsg = errData?.error?.message || `HTTP ${res.status}`;
          this.toast.error(`Error al conectar con Gemini: ${lastErrMsg}`, 'Gemini AI');
        }
      } else {
        this.toast.success(`Clave de ${this.getProviderDisplayName()} verificada.`, 'Cerebro IA');
      }
    } catch (e: unknown) {
      const lastErrMsg = e instanceof Error ? e.message : String(e);
      this.toast.error(`Error al conectar con ${this.getProviderDisplayName()}: ${lastErrMsg}`, 'Cerebro IA');
    } finally {
      this.isTestingGemini.set(false);
    }
  }
}
