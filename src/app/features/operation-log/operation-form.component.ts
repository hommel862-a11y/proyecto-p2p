import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_PIPES } from '../../core/format';
import { CounterpartyService } from '../../core/counterparty.service';
import { AccountsService } from '../../core/accounts.service';
import { BankNotifierService } from '../../core/bank-notifier.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { MarketHistoryService } from '../../core/market-history.service';
import { Finance360Service } from '../../core/finance-360.service';
import { TradeTimerService } from '../../core/trade-timer.service';
import { ToastService } from '../../core/toast.service';
import {
  VoiceDictationService,
  type ParsedP2pVoiceCommand,
} from '../../core/voice-dictation.service';
import {
  clampMoney as sharedClampMoney,
  roundMoney,
  computeAccountVelocity,
  getRotationRecommendation,
  auditSopComplianceEnforcement,
  parseBankNotification,
  normalizeIdentityDoc,
  type Operation,
  type AccountUsage,
  type AntiTriangulationAssessment,
  type BankCode,
} from '@p2p/core';
import {
  BANK_CODES,
  buildPagoMovilQrString,
  generateSimpleQrSvg,
  type PagoMovilPayload,
} from '../../core/pago-movil-dispatcher';

export type OpDraft = Omit<Operation, 'id' | 'timestamp'>;

@Component({
  selector: 'app-operation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FORMAT_PIPES],
  template: `
    <div class="apple-dock-card" [class.glow-accent]="form().type === 'buy'" [class.glow-danger]="form().type === 'sell'" style="padding: 22px 24px;">
      <!-- MULTI-SLOT IN-FLIGHT ORDERS BAR + HOTKEYS TELEMETRY -->
      <div
        style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.07);"
      >
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 0.72rem; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em;">
            ⚡ Órdenes en Tránsito (Multi-Slot):
          </span>
          @for (slot of [0, 1, 2]; track slot) {
            <button
              type="button"
              class="quick-fill-chip font-mono"
              [class.accent]="activeSlot() === slot && getSlotDraft(slot).type === 'buy'"
              [class.danger]="activeSlot() === slot && getSlotDraft(slot).type === 'sell'"
              [class.gold]="activeSlot() !== slot && isSlotOccupied(slot)"
              style="padding: 5px 12px; font-size: 0.75rem;"
              (click)="selectSlot(slot)"
              [title]="'Cambiar a Slot de Orden #' + (slot + 1) + ' (Atajo: Alt+' + (slot + 1) + ')'"
            >
              <span>{{ activeSlot() === slot ? '🟢' : isSlotOccupied(slot) ? '⏳' : '⚪' }}</span>
              <strong>Orden #{{ slot + 1 }}</strong>
              <span style="opacity: 0.85;">· {{ getSlotSummaryLabel(slot) }}</span>
            </button>
          }
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="apple-pill-mini muted font-mono" title="Atajos rápidos de teclado activos en el Centro de Operaciones">
            ⌨️ Alt+V Voz · Alt+1/2/3 Slots · Alt+R SUDEBAN · Ctrl+V Pegar · Ctrl+Enter Registrar
          </span>
        </div>
      </div>

      <div class="terminal-card-header" style="flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
        <div class="card-header-title">
          <span class="card-icon">{{ editingOpId() ? '✏️' : '⚡' }}</span>
          <span class="card-title">
            {{ editingOpId() ? 'Editando Operación en Libro Mayor' : 'Nueva Operación en Libro Mayor' }}
          </span>
          @if (editingOpId()) {
            <span class="apple-pill-mini gold font-mono" style="margin-left: 6px;">
              MODO EDICIÓN
            </span>
          }
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
          <div class="quantum-segmented-switch">
            <button
              type="button"
              class="seg-btn buy"
              [class.active]="form().type === 'buy'"
              (click)="onTypeChange('buy')"
            >
              <span class="quantum-live-dot" [class.gold]="form().type !== 'buy'"></span>
              🟢 COMPRA
            </button>
            <button
              type="button"
              class="seg-btn sell"
              [class.active]="form().type === 'sell'"
              (click)="onTypeChange('sell')"
            >
              <span class="quantum-live-dot danger"></span>
              🔴 VENTA
            </button>
          </div>
          <button
            type="button"
            class="apple-pill-btn"
            [class.apple-btn-danger]="voice.isListening() && voice.activeContext() === 'p2p'"
            [class.apple-btn-gold]="!(voice.isListening() && voice.activeContext() === 'p2p')"
            (click)="toggleVoiceDictation()"
            title="Dicta la operación completa por voz (Ej: 'Venta de 250 USDT a 78.60 por Banesco ref 849312 cédula 18940211') — Atajo: Alt+V"
          >
            @if (voice.isListening() && voice.activeContext() === 'p2p') {
              🔴 Escuchando... (Detener)
            } @else {
              🎙️ Dictar Operación (Alt+V)
            }
          </button>
          <button
            type="button"
            class="apple-pill-btn apple-btn-accent"
            (click)="pasteAndReconcileFromClipboard()"
            title="Lee el SMS/comprobante directo de tu portapapeles, concilia y rellena el formulario (Atajo: Ctrl+V)"
          >
            📋 Pegar y Conciliar (1-Clic)
          </button>
          <button
            type="button"
            class="apple-pill-btn apple-btn-secondary"
            (click)="toggleReconciler()"
          >
            📥 {{ showReconciler() ? 'Ocultar Lector' : 'Lector Manual SMS' }}
          </button>
          @if (form().type === 'buy') {
            <button
              type="button"
              class="apple-pill-btn apple-btn-gold"
              (click)="toggleQrDispatcher()"
            >
              📲 {{ showQrDispatcher() ? 'Ocultar QR' : 'QR Pago Móvil' }}
            </button>
          }
          <button
            type="button"
            class="apple-pill-btn"
            [class.apple-btn-accent]="autoCalcMath()"
            [class.apple-btn-secondary]="!autoCalcMath()"
            (click)="toggleAutoCalc()"
            title="Activa o pausa el cálculo bidireccional automático entre Precio, VES y USDT"
          >
            {{ autoCalcMath() ? '🔗 Auto-Cálculo: ON' : '⛓️‍💥 Auto-Cálculo: OFF' }}
          </button>
        </div>
      </div>

      <!-- PÍLDORA INTERACTIVA DE DICTADO POR VOZ SEMÁNTICO P2P -->
      @if ((voice.isListening() && voice.activeContext() === 'p2p') || lastVoiceCommand()) {
        <div
          style="background: rgba(12, 18, 32, 0.88); border: 1px solid rgba(226, 183, 85, 0.42); border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;"
        >
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1;">
            <span class="apple-pill-mini" [class.badge-danger]="voice.isListening()" [class.live]="!voice.isListening()">
              {{ voice.isListening() ? '🎙️ ESCUCHANDO VOZ EN VIVO' : '✨ DICTADO PROCESADO' }}
            </span>
            <span class="font-mono" style="font-size: 0.84rem; color: #f8fafc;">
              "{{ voice.isListening() ? (voice.interimTranscript() || 'Habla ahora: ej. Venta de 250 USDT a 78.60 por Banesco ref 849312...') : lastVoiceCommand()?.rawTranscript }}"
            </span>
          </div>

          @if (lastVoiceCommand(); as cmd) {
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              @for (b of cmd.summaryBadges; track b) {
                <span class="apple-pill-mini gold font-mono">{{ b }}</span>
              }
              <button
                type="button"
                class="quick-fill-chip"
                (click)="clearVoiceBanner()"
                title="Cerrar aviso de dictado"
              >
                ✕
              </button>
            </div>
          }
        </div>
      }

      <!-- BARRA TÁCTICA DE COORDINACIÓN RÁPIDA PARA EL CHAT DE BINANCE (1-CLIC) -->
      <div
        style="background: rgba(15, 22, 38, 0.65); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 9px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;"
      >
        <span style="font-size: 0.74rem; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 6px;">
          💬 Coordinación Rápida Chat P2P (Copia al Portapapeles en 1-Clic):
        </span>
        <div class="quick-fill-group" style="margin: 0;">
          <button
            type="button"
            class="quick-fill-chip gold"
            (click)="copyChatTemplate('payment_details')"
            title="Copia los datos bancarios de la cuenta activa, el monto exacto en Bs y la cláusula anti-terceros"
          >
            🏦 1. Enviar Datos de Pago
          </button>
          <button
            type="button"
            class="quick-fill-chip accent"
            (click)="copyChatTemplate('verifying')"
            title="Copia mensaje de recepción y verificación bancaria en curso (60s)"
          >
            🔍 2. En Verificación (60s)
          </button>
          <button
            type="button"
            class="quick-fill-chip accent"
            (click)="copyChatTemplate('released')"
            title="Copia mensaje de cierre exitoso y solicitud de calificación positiva"
          >
            ✅ 3. Orden Liberada + Fidelizar
          </button>
        </div>
      </div>

      <!-- Panel de Ingesta y Conciliación Pasiva -->
      @if (showReconciler()) {
        <div
          style="background: rgba(5, 8, 15, 0.75); border: 1px solid rgba(216, 180, 92, 0.35); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;"
          >
            <span
              style="font-size: 0.78rem; font-weight: 700; color: var(--gold-strong); text-transform: uppercase; letter-spacing: 0.05em;"
            >
              Lector Inteligente de Notificaciones (Mercantil, Bancamiga, Banesco, Provincial, BDV, BNC, Bancaribe, Banplus)
            </span>
            <span class="apple-pill-mini gold font-mono"
              >Auto-Detección + Anti-Triangulación</span
            >
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
            <div class="input-control-wrap" style="flex: 1; min-width: 260px;">
              <input
                type="text"
                class="terminal-input"
                placeholder="Pega aquí el SMS o correo del banco (ej: MERCANTIL: Recibiste Pago Movil por Bs. 2.450,00 de CI: V18450123 Ref: 987654)"
                [value]="rawBankNotification()"
                (input)="rawBankNotification.set($any($event.target).value)"
                style="font-size: 0.84rem;"
              />
            </div>
            <button
              type="button"
              class="apple-pill-btn apple-btn-primary"
              (click)="processBankReceipt()"
            >
              ⚡ Conciliar y Rellenar
            </button>
          </div>

          @if (bankNotifier.lastReconciliation(); as rec) {
            <div
              style="margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 0.82rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;"
              [style.background]="
                rec.status === 'VERIFIED_SAFE'
                  ? 'rgba(47, 208, 143, 0.14)'
                  : 'rgba(239, 68, 68, 0.14)'
              "
              [style.color]="rec.status === 'VERIFIED_SAFE' ? '#2fd08f' : '#f87171'"
              [style.border-left]="
                rec.status === 'VERIFIED_SAFE' ? '3px solid #2fd08f' : '3px solid #ef4444'
              "
            >
              <span>{{ rec.message }}</span>
              @if (unregisteredPayer(); as newPayer) {
                <button
                  type="button"
                  class="apple-pill-btn apple-btn-accent"
                  style="font-size: 0.74rem; padding: 4px 12px;"
                  (click)="quickOnboardCounterparty()"
                >
                  ➕ Fichar {{ newPayer.documentId }} ({{ newPayer.bankName }}) en CRM
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Despachador Asistido de Pago Móvil (Human-in-the-Loop) -->
      @if (showQrDispatcher() && form().type === 'buy') {
        <div
          style="background: rgba(5, 8, 15, 0.75); border: 1px solid rgba(47, 208, 143, 0.35); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;"
          >
            <span
              style="font-size: 0.78rem; font-weight: 700; color: #2fd08f; text-transform: uppercase; letter-spacing: 0.05em;"
            >
              📲 Despachador QR Pago Móvil ({{ selectedQrBankInfo().name }} — {{ selectedQrBankInfo().code }})
            </span>
            <div class="quick-fill-group">
              @for (b of bankCodeEntries; track b.key) {
                <button
                  type="button"
                  class="quick-fill-chip"
                  [class.accent]="qrBankKey() === b.key"
                  (click)="qrBankKey.set(b.key)"
                >
                  {{ b.code }} {{ b.shortName }}
                </button>
              }
            </div>
          </div>

          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            @if (qrCodeUrl(); as svg) {
              <div
                style="background: #fff; padding: 8px; border-radius: 10px; display: inline-flex;"
              >
                <img
                  [src]="svg"
                  alt="QR Pago Móvil"
                  style="width: 120px; height: 120px; display: block;"
                />
              </div>
            }
            <div
              style="display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 220px;"
            >
              <div style="font-size: 0.82rem; color: var(--muted);">
                Escanea con la app de tu banco o copia los datos exactos de transferencia con 1 clic:
              </div>

              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button
                  type="button"
                  class="apple-pill-btn apple-btn-secondary"
                  style="font-size: 0.75rem; padding: 5px 12px;"
                  (click)="copy(selectedQrBankInfo().code, 'Banco')"
                >
                  🏦 Banco: {{ selectedQrBankInfo().code }} ({{ selectedQrBankInfo().name }})
                </button>
                <button
                  type="button"
                  class="apple-pill-btn apple-btn-secondary"
                  style="font-size: 0.75rem; padding: 5px 12px;"
                  (click)="
                    copy(selectedCounterparty()?.documentId || form().payerName || '', 'Cédula')
                  "
                >
                  📋 Cédula: {{ selectedCounterparty()?.documentId || form().payerName || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="apple-pill-btn apple-btn-secondary"
                  style="font-size: 0.75rem; padding: 5px 12px;"
                  (click)="copy(selectedCounterparty()?.phone || '', 'Teléfono')"
                >
                  📋 Teléfono: {{ selectedCounterparty()?.phone || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="apple-pill-btn apple-btn-gold"
                  style="font-size: 0.75rem; padding: 5px 12px;"
                  (click)="copy(form().vesAmount.toFixed(2), 'Monto')"
                >
                  📋 Monto: {{ form().vesAmount | ves }}
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <form (submit)="$event.preventDefault(); onSubmitForm()">
        <div class="terminal-input-grid grid-3">
          <div class="terminal-field">
            <label class="terminal-label" for="op-field-type">
              <span>Tipo de Operación</span>
              <span class="terminal-subtext">Flujo de orden</span>
            </label>
            <div class="input-control-wrap">
              <select
                id="op-field-type"
                class="terminal-select"
                [value]="form().type"
                (change)="onTypeChange($any($event.target).value)"
              >
                <option value="buy">🟢 Compra (VES → Cripto)</option>
                <option value="sell">🔴 Venta (Cripto → VES)</option>
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-pair">
              <span>Par Comercial</span>
              <span class="terminal-subtext">Activo base</span>
            </label>
            <div class="input-control-wrap">
              <select
                id="op-field-pair"
                class="terminal-select"
                [value]="form().pair"
                (change)="onFieldChange('pair', $any($event.target).value)"
              >
                <option value="USDT">USDT / VES</option>
                <option value="EUR">EUR / VES</option>
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-price">
              <span>Precio Pactado</span>
              <span class="terminal-subtext">VES por {{ form().pair }}</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix" aria-hidden="true">VES</span>
              <input
                id="op-field-price"
                type="number"
                min="0"
                step="0.01"
                class="terminal-input font-bold"
                [value]="form().price"
                (input)="onPriceInput(clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
            </div>
            <!-- Presets rápidos de Precio del Libro L2 y Break-Even -->
            <div class="quick-fill-group" style="margin-top: 6px;">
              @if (marketPrices().buy > 0) {
                <button
                  type="button"
                  class="quick-fill-chip accent"
                  (click)="applyPricePreset(marketPrices().buy)"
                  title="Aplicar precio de punta Compra actual"
                >
                  🟢 Compra {{ marketPrices().buy | num }}
                </button>
              }
              @if (marketPrices().sell > 0) {
                <button
                  type="button"
                  class="quick-fill-chip danger"
                  (click)="applyPricePreset(marketPrices().sell)"
                  title="Aplicar precio de punta Venta actual"
                >
                  🔴 Venta {{ marketPrices().sell | num }}
                </button>
              }
              @if (openInventoryAvgPrice() > 0) {
                <button
                  type="button"
                  class="quick-fill-chip gold"
                  (click)="applyPricePreset(recommendedExitPrice())"
                  title="Precio promedio FIFO de tu inventario abierto + 1.0% de margen seguro"
                >
                  ⚖️ Salida +1%: {{ recommendedExitPrice() | num }}
                </button>
              }
              <button
                type="button"
                class="quick-fill-chip"
                (click)="refreshOrderbookPrice()"
                title="Actualizar precios en vivo desde Binance P2P"
              >
                🔄 L2
              </button>
            </div>
            @if (form().type === 'sell' && form().price > 0 && openInventoryAvgPrice() > 0 && form().price < openInventoryAvgPrice()) {
              <div class="pill" style="border-color: rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.12); color: #f87171; font-size: 0.72rem; padding: 4px 8px; margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                <span class="quantum-live-dot danger"></span>
                <span><strong>Alerta de Margen:</strong> Tasa por debajo de tu costo VWAP ({{ openInventoryAvgPrice() | ves }}). Estás vendiendo a pérdida.</span>
              </div>
            }
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-ves">
              <span>Monto en VES</span>
              <span class="terminal-subtext">Bolívares totales</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix" aria-hidden="true">Bs</span>
              <input
                id="op-field-ves"
                type="number"
                min="0"
                step="0.01"
                class="terminal-input"
                [value]="form().vesAmount"
                (input)="onVesInput(clampMoney(+$any($event.target).value))"
                placeholder="0.00"
                [attr.aria-invalid]="limitExceededWarning() ? 'true' : null"
                [attr.aria-describedby]="limitExceededWarning() ? 'op-limit-warning' : null"
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-crypto">
              <span>Monto en {{ form().pair }}</span>
              <span class="terminal-subtext">Volumen cripto</span>
            </label>
            <div class="input-control-wrap">
              <input
                id="op-field-crypto"
                type="number"
                min="0"
                step="0.000001"
                class="terminal-input highlight-gold font-bold"
                [value]="form().usdtAmount"
                (input)="onCryptoInput(clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
              <span class="input-suffix" aria-hidden="true">{{ form().pair }}</span>
            </div>
            <div class="quick-fill-group" style="margin-top: 6px;">
              <span class="text-muted" style="font-size: 0.68rem; font-weight: 700;">Llenado:</span>
              @if (form().type === 'sell' && openInventoryAmount() > 0) {
                <button type="button" class="quick-fill-chip gold" (click)="fillCryptoPct(0.25)" title="25% del stock abierto">25% ({{ (openInventoryAmount() * 0.25) | num }})</button>
                <button type="button" class="quick-fill-chip gold" (click)="fillCryptoPct(0.50)" title="50% del stock abierto">50% ({{ (openInventoryAmount() * 0.50) | num }})</button>
                <button type="button" class="quick-fill-chip gold" (click)="fillCryptoPct(1.00)" title="100% de todo el stock abierto">100% (Todo)</button>
              } @else {
                <button type="button" class="quick-fill-chip accent" (click)="fillCryptoAmount(100)">100 {{ form().pair }}</button>
                <button type="button" class="quick-fill-chip accent" (click)="fillCryptoAmount(500)">500 {{ form().pair }}</button>
                <button type="button" class="quick-fill-chip accent" (click)="fillCryptoAmount(1000)">1.000 {{ form().pair }}</button>
              }
            </div>
            @if (effectiveSpreadHint(); as spreadHint) {
              <div style="font-size: 0.7rem; margin-top: 4px;" [style.color]="spreadHint.isPositive ? 'var(--accent)' : 'var(--danger)'">
                {{ spreadHint.label }}
              </div>
            }
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-fees">
              <span>Comisiones Pagadas</span>
              <span class="terminal-subtext">Bancos / Red</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix" aria-hidden="true">Bs</span>
              <input
                id="op-field-fees"
                type="number"
                min="0"
                step="0.01"
                class="terminal-input"
                [value]="form().fees"
                (input)="onFieldChange('fees', clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
            </div>
            <div class="quick-fill-group" style="margin-top: 6px;">
              <button
                type="button"
                class="quick-fill-chip"
                (click)="applyFeePct(0)"
              >
                0% Mismo Banco
              </button>
              <button
                type="button"
                class="quick-fill-chip"
                (click)="applyFeePct(0.3)"
                title="Comisión Pago Móvil interbancario (0.3%)"
              >
                0.3% PM Inter
              </button>
              <button
                type="button"
                class="quick-fill-chip"
                (click)="applyFeePct(1.5)"
                title="Comisión pasarela / IGTF (1.5%)"
              >
                1.5% Pasarela
              </button>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-counterparty">
              <span>Contraparte (CRM)</span>
              <span class="terminal-subtext">Directorio KYC</span>
            </label>
            <div class="input-control-wrap">
              <select
                id="op-field-counterparty"
                class="terminal-select"
                [value]="form().counterpartyId"
                (change)="onCounterpartySelect($any($event.target).value)"
              >
                <option value="">Seleccionar del directorio...</option>
                @for (cp of crmService.counterparties(); track cp.id) {
                  <option [value]="cp.id">
                    {{ cp.alias }} ({{ cp.realName }}) [{{ cp.reputation }}]
                  </option>
                }
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-payer">
              <span>Titular de Pago</span>
              <span class="terminal-subtext">Anti-Triangulación</span>
            </label>
            <div class="input-control-wrap">
              <input
                id="op-field-payer"
                type="text"
                class="terminal-input"
                placeholder="Nombre o Cédula en comprobante"
                [value]="form().payerName"
                (input)="onFieldChange('payerName', $any($event.target).value)"
                [attr.aria-invalid]="antiTriangulation().warning ? 'true' : null"
                [attr.aria-describedby]="
                  antiTriangulation().warning ? 'op-triangulation-warning' : null
                "
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label" for="op-field-bank">
              <span>Cuenta Bancaria / Riel</span>
              <button
                type="button"
                class="quick-fill-chip accent"
                style="padding: 1px 8px; font-size: 0.65rem;"
                (click)="autoRouteBestAccount()"
                title="Selecciona automáticamente la cuenta con mejor velocidad SUDEBAN y cupo disponible"
              >
                🎯 Auto-Enrutar
              </button>
            </label>
            <div class="input-control-wrap">
              <select
                id="op-field-bank"
                class="terminal-select"
                [value]="form().bankAccountId"
                (change)="onBankSelect($any($event.target).value)"
                [attr.aria-invalid]="limitExceededWarning() ? 'true' : null"
                [attr.aria-describedby]="limitExceededWarning() ? 'op-limit-warning' : null"
              >
                <option value="">Sin asignar / Otra cuenta</option>
                @for (acc of accountsService.accounts(); track acc.id) {
                  <option [value]="acc.id">
                    {{ acc.bankName }} ({{ acc.rail }}) — Límite:
                    {{ acc.dailyLimitVes ? (acc.dailyLimitVes | ves) : 'Ilimitado' }}
                  </option>
                }
              </select>
            </div>
            @if (selectedAccountTelemetry(); as tel) {
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; font-size: 0.7rem;">
                <span class="font-mono text-muted">
                  Saldo: <strong style="color: var(--text);">{{ tel.usage.currentBalanceVes | ves }}</strong> · Libre: {{ tel.usage.remainingLimitVes | ves }}
                </span>
                <span
                  class="apple-pill-mini font-mono"
                  [class.live]="tel.velocity.velocityHealth === 'OPTIMAL'"
                  [class.badge-danger]="tel.velocity.velocityHealth === 'SATURATED'"
                  [class.gold]="tel.velocity.velocityHealth !== 'OPTIMAL' && tel.velocity.velocityHealth !== 'SATURATED'"
                >
                  SUDEBAN: {{ tel.velocity.todayTransactionCount }}/{{ tel.velocity.maxDailyTransactions }} ops ({{ tel.velocity.velocityHealth }})
                </span>
              </div>
            }
          </div>

          <div class="terminal-field full-width">
            <label class="terminal-label" for="op-field-note">
              <span>Notas del Comercio / Referencia Bancaria</span>
              <span class="terminal-subtext">Auditoría & Anti-Replay</span>
            </label>
            <div class="input-control-wrap">
              <input
                id="op-field-note"
                type="text"
                class="terminal-input"
                placeholder="Ej: Comerciante VIP #12 - Ref: 987654"
                [value]="form().merchantNote"
                (input)="onFieldChange('merchantNote', $any($event.target).value)"
              />
            </div>
          </div>
        </div>

        @if (duplicateRefWarning(); as dupWarn) {
          <div
            style="background: rgba(255, 95, 109, 0.16); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 8px; font-size: 0.84rem; color: var(--danger); margin: 12px 0 6px;"
            role="alert"
          >
            🚨 <strong>ALERTA ANTI-REPLAY (REFERENCIA DUPLICADA):</strong> {{ dupWarn }}
          </div>
        }

        @if (coherenceWarning(); as cohWarn) {
          <div
            style="background: rgba(234, 179, 8, 0.14); border-left: 4px solid var(--gold); padding: 10px 14px; border-radius: 8px; font-size: 0.82rem; color: var(--gold-strong); margin: 10px 0 6px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;"
            role="alert"
          >
            <span>⚠️ <strong>DESCALCE MATEMÁTICO (FAT-FINGER):</strong> {{ cohWarn }}</span>
            <button
              type="button"
              class="apple-pill-btn apple-btn-gold"
              style="font-size: 0.74rem; padding: 4px 12px;"
              (click)="reconcileMathDiscrepancy()"
            >
              🔧 Ajustar VES a {{ (form().usdtAmount * form().price) | ves }}
            </button>
          </div>
        }

        @if (antiTriangulation().warning; as warn) {
          <div
            id="op-triangulation-warning"
            [style.background]="
              antiTriangulation().riskLevel === 'CRITICAL'
                ? 'rgba(255, 95, 109, 0.15)'
                : 'rgba(239, 201, 76, 0.15)'
            "
            [style.border-left]="
              antiTriangulation().riskLevel === 'CRITICAL'
                ? '4px solid var(--danger)'
                : '4px solid var(--gold)'
            "
            [style.color]="
              antiTriangulation().riskLevel === 'CRITICAL' ? 'var(--danger)' : 'var(--gold-strong)'
            "
            style="padding: 10px 14px; border-radius: 8px; font-size: 0.84rem; margin: 12px 0 6px;"
            role="alert"
          >
            <strong>{{
              antiTriangulation().riskLevel === 'CRITICAL'
                ? '🛑 RIESGO CRÍTICO:'
                : '⚠️ ADVERTENCIA:'
            }}</strong>
            {{ warn }}
          </div>
        }

        @if (limitExceededWarning(); as warn) {
          <div
            id="op-limit-warning"
            style="background: rgba(255, 95, 109, 0.12); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 8px; font-size: 0.84rem; color: var(--danger); margin: 8px 0;"
            role="alert"
          >
            ⚠️ {{ warn }}
          </div>
        }

        @if (form().receiptImage) {
          <div
            style="background: rgba(47, 208, 143, 0.08); border: 1px solid rgba(47, 208, 143, 0.35); padding: 8px 12px; border-radius: 10px; font-size: 0.8rem; display: flex; align-items: center; justify-content: space-between; margin-top: 10px;"
          >
            <span style="display: flex; align-items: center; gap: 6px; color: #2fd08f;">
              📸 <strong>Comprobante Bancario Adjunto:</strong> {{ form().receiptReference || 'Captura vinculada' }}
            </span>
            <button
              type="button"
              class="apple-pill-btn apple-btn-accent"
              style="padding: 4px 10px; font-size: 0.72rem;"
              (click)="showReceiptPreview.set(!showReceiptPreview())"
            >
              {{ showReceiptPreview() ? 'Ocultar Captura' : 'Ver Captura' }}
            </button>
          </div>
          @if (showReceiptPreview()) {
            <div style="text-align: center; margin-top: 8px; margin-bottom: 8px;">
              <img
                [src]="form().receiptImage"
                alt="Comprobante de pago"
                style="max-height: 220px; max-width: 100%; border-radius: 8px; border: 1px solid var(--border); object-fit: contain;"
              />
            </div>
          }
        }

        <div class="terminal-card-footer" style="padding-top: 14px; margin-top: 14px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="checkbox-label" style="margin: 0; flex-direction: row !important; align-items: center; gap: 8px;">
              <input
                type="checkbox"
                [checked]="form().errorFree"
                (change)="onFieldChange('errorFree', $any($event.target).checked)"
              />
              <span style="font-size: 0.82rem;"
                >Operación ejecutada sin errores (Escalera de disciplina)</span
              >
            </label>
            <span
              class="apple-pill-mini font-mono"
              [class.live]="sopAudit().isCompliant"
              [class.gold]="!sopAudit().isCompliant"
              [title]="sopAudit().summary"
            >
              🛡️ SOP Score: {{ sopAudit().complianceScore }}%
            </span>
          </div>
          <div class="form-actions" style="margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            @if (editingOpId()) {
              <button
                type="button"
                class="apple-pill-btn apple-btn-secondary"
                (click)="cancelEdit.emit()"
              >
                Cancelar Edición
              </button>
            }
            <button type="button" class="apple-pill-btn apple-btn-secondary" (click)="resetForm()">
              Limpiar
            </button>
            <button type="submit" class="apple-pill-btn apple-btn-primary" style="padding: 8px 22px; font-weight: 800;">
              {{ editingOpId() ? '💾 Guardar Cambios' : '⚡ Registrar Operación' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class OperationFormComponent {
  readonly crmService = inject(CounterpartyService);
  readonly accountsService = inject(AccountsService);
  readonly bankNotifier = inject(BankNotifierService);
  readonly voice = inject(VoiceDictationService);
  private readonly binanceP2p = inject(BinanceP2pService);
  private readonly marketHistory = inject(MarketHistoryService);
  private readonly finance360 = inject(Finance360Service);
  private readonly timer = inject(TradeTimerService);
  private readonly toast = inject(ToastService);

  readonly form = input.required<OpDraft>();
  readonly selectedAccountUsage = input<AccountUsage | null>(null);
  readonly limitExceededWarning = input<string | null>(null);
  readonly duplicateRefWarning = input<string | null>(null);
  readonly openInventoryAvgPrice = input<number>(0);
  readonly openInventoryAmount = input<number>(0);
  readonly editingOpId = input<string | null>(null);
  readonly antiTriangulation = input<AntiTriangulationAssessment>({
    isSafe: true,
    riskLevel: 'LOW',
    isThirdPartyPayment: false,
  });

  readonly formChange = output<Partial<OpDraft>>();
  readonly counterpartySelect = output<string>();
  readonly submitForm = output<void>();
  readonly cancelEdit = output<void>();

  readonly showReconciler = signal<boolean>(false);
  readonly showQrDispatcher = signal<boolean>(false);
  readonly showReceiptPreview = signal<boolean>(false);
  readonly rawBankNotification = signal<string>('');
  readonly autoCalcMath = signal<boolean>(true);
  readonly qrBankKey = signal<string>('MERCANTIL');
  readonly lastVoiceCommand = signal<ParsedP2pVoiceCommand | null>(null);
  readonly activeSlot = signal<number>(0);
  readonly slotDrafts = signal<[OpDraft, OpDraft, OpDraft]>([
    this.createEmptyDraft('buy'),
    this.createEmptyDraft('sell'),
    this.createEmptyDraft('buy'),
  ]);
  readonly unregisteredPayer = signal<{
    documentId: string;
    bankName: string;
    phone?: string;
  } | null>(null);

  private createEmptyDraft(type: 'buy' | 'sell' = 'buy'): OpDraft {
    return {
      type,
      pair: 'USDT',
      vesAmount: 0,
      usdtAmount: 0,
      price: 0,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: false,
      bankAccountId: '',
      counterpartyId: '',
      payerName: '',
    };
  }

  private readonly syncSlotEffect = effect(() => {
    const currentForm = this.form();
    const idx = this.activeSlot();
    this.slotDrafts.update((arr) => {
      const next: [OpDraft, OpDraft, OpDraft] = [{ ...arr[0] }, { ...arr[1] }, { ...arr[2] }];
      next[idx] = { ...currentForm };
      return next;
    });
  });

  getSlotDraft(slotIndex: number): OpDraft {
    if (slotIndex === this.activeSlot()) {
      return this.form();
    }
    return this.slotDrafts()[slotIndex] ?? this.createEmptyDraft();
  }

  isSlotOccupied(slotIndex: number): boolean {
    const d = this.getSlotDraft(slotIndex);
    return d.usdtAmount > 0 || d.vesAmount > 0 || Boolean(d.counterpartyId) || Boolean(d.payerName);
  }

  getSlotSummaryLabel(slotIndex: number): string {
    const d = this.getSlotDraft(slotIndex);
    const dir = d.type === 'sell' ? 'VENTA' : 'COMPRA';
    if (d.usdtAmount > 0) {
      return `${dir} ${d.usdtAmount.toFixed(2)} ${d.pair}`;
    }
    if (d.vesAmount > 0) {
      return `${dir} ${d.vesAmount.toLocaleString('es-VE')} Bs`;
    }
    return `Libre (${dir})`;
  }

  selectSlot(slotIndex: number): void {
    if (slotIndex === this.activeSlot() || slotIndex < 0 || slotIndex > 2) return;
    const current = this.form();
    const prevIdx = this.activeSlot();
    const allSlots = this.slotDrafts();
    const nextSlots: [OpDraft, OpDraft, OpDraft] = [
      { ...allSlots[0] },
      { ...allSlots[1] },
      { ...allSlots[2] },
    ];
    nextSlots[prevIdx] = { ...current };
    this.slotDrafts.set(nextSlots);
    this.activeSlot.set(slotIndex);

    const targetDraft = nextSlots[slotIndex];
    this.formChange.emit({ ...targetDraft });
    this.toast.info(
      `Cambiaste a Orden en Tránsito #${slotIndex + 1} (${this.getSlotSummaryLabel(slotIndex)})`,
      'Multi-Slot P2P',
    );
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.toggleVoiceDictation();
      return;
    }
    if (event.altKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
      event.preventDefault();
      this.selectSlot(Number(event.key) - 1);
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.autoRouteBestAccount();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.onSubmitForm();
    }
  }

  @HostListener('window:paste', ['$event'])
  onGlobalPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (!text) return;
    event.preventDefault();
    this.rawBankNotification.set(text);
    this.showReconciler.set(true);
    this.processBankReceipt();
  }

  toggleVoiceDictation(): void {
    this.voice.startListening('p2p', (transcript) => {
      this.applyVoiceCommand(transcript);
    });
  }

  clearVoiceBanner(): void {
    this.lastVoiceCommand.set(null);
  }

  applyVoiceCommand(transcript: string): void {
    const parsed = this.voice.parseP2pCommand(transcript);
    this.lastVoiceCommand.set(parsed);

    const patch: Partial<OpDraft> = {};
    if (parsed.type) {
      patch.type = parsed.type;
    }
    if (parsed.pair) {
      patch.pair = parsed.pair;
    }

    const activePrice =
      parsed.price ??
      (this.form().price > 0
        ? this.form().price
        : (parsed.type ?? this.form().type) === 'sell'
          ? this.marketPrices().sell
          : this.marketPrices().buy);

    if (activePrice > 0) {
      patch.price = activePrice;
    }

    if (parsed.usdtAmount && parsed.usdtAmount > 0) {
      patch.usdtAmount = parsed.usdtAmount;
      if (activePrice > 0 && !parsed.vesAmount) {
        patch.vesAmount = roundMoney(parsed.usdtAmount * activePrice, 2);
      }
    }

    if (parsed.vesAmount && parsed.vesAmount > 0) {
      patch.vesAmount = parsed.vesAmount;
      if (activePrice > 0 && !parsed.usdtAmount) {
        patch.usdtAmount = Number((parsed.vesAmount / activePrice).toFixed(6));
      }
    }

    if (parsed.bankCode) {
      if (BANK_CODES[parsed.bankCode]) {
        this.qrBankKey.set(parsed.bankCode);
      }
      const matchingAcc = this.accountsService
        .accounts()
        .find((a) => a.bankCode === parsed.bankCode && a.status !== 'DISABLED');
      if (matchingAcc) {
        patch.bankAccountId = matchingAcc.id;
      }
    }

    if (parsed.documentId) {
      patch.payerName = parsed.documentId;
      const normDoc = normalizeIdentityDoc(parsed.documentId).replace(/[^0-9]/g, '');
      const matchedCp = this.crmService
        .counterparties()
        .find((c) => normalizeIdentityDoc(c.documentId).replace(/[^0-9]/g, '') === normDoc);
      if (matchedCp) {
        patch.counterpartyId = matchedCp.id;
      }
    }

    if (parsed.reference) {
      patch.merchantNote = `Ref: ${parsed.reference}${parsed.documentId ? ` (${parsed.documentId})` : ''}`;
      patch.errorFree = true;
    }

    patch.notes = `Dictado por voz: "${parsed.rawTranscript}"`;
    this.formChange.emit(patch);
    this.toast.success(
      `Dictado P2P aplicado (${parsed.summaryBadges.join(' · ') || 'Datos cargados'})`,
      '🎙️ Voz Semántica P2P',
    );
  }

  copyChatTemplate(templateType: 'payment_details' | 'verifying' | 'released'): void {
    const f = this.form();
    const acc = f.bankAccountId ? this.accountsService.getAccountById(f.bankAccountId) : null;
    const bankLabel = acc ? `${acc.bankName} (${acc.accountNumberMasked})` : this.selectedQrBankInfo().name;
    const bankCode = acc?.bankCode ? (BANK_CODES[acc.bankCode]?.code ?? '') : this.selectedQrBankInfo().code;
    const vesStr =
      f.vesAmount > 0
        ? `Bs. ${f.vesAmount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'el monto acordado en Bs';

    let message = '';
    if (templateType === 'payment_details') {
      message = `👋 ¡Hola! Por favor realiza el Pago Móvil / Transferencia exacta por ${vesStr} a:\n🏦 Banco: ${bankLabel} ${bankCode ? `(${bankCode})` : ''}\n⚠️ IMPORTANTE: Exclusivamente desde cuenta TITULAR verificada (NO aceptamos pagos de terceros ni cuentas jurídicas no registradas). Envía captura o número de referencia al transferir.`;
    } else if (templateType === 'verifying') {
      message = `🔍 Pago recibido en cola de conciliación bancaria (${bankLabel}). Estoy verificando en cuenta en este momento, dame 60 segundos por favor.`;
    } else {
      message = `✅ ¡Operación verificada y activos liberados exitosamente! Muchas gracias por operar con nosotros. Te dejamos calificación 100% positiva ⭐`;
    }

    navigator.clipboard?.writeText(message).then(() => {
      this.toast.success(
        'Plantilla copiada al portapapeles. Pégala con Ctrl+V en el chat de Binance.',
        '💬 Coordinación Rápida',
      );
    });
  }

  readonly bankCodeEntries = [
    { key: 'BANESCO', code: '0134', shortName: 'Banesco' },
    { key: 'MERCANTIL', code: '0105', shortName: 'Mercantil' },
    { key: 'BDV', code: '0102', shortName: 'BDV' },
    { key: 'BANCAMIGA', code: '0172', shortName: 'Bancamiga' },
    { key: 'PROVINCIAL', code: '0108', shortName: 'Provincial' },
    { key: 'BNC', code: '0191', shortName: 'BNC' },
    { key: 'BANCARIBE', code: '0114', shortName: 'Bancaribe' },
    { key: 'BANPLUS', code: '0174', shortName: 'Banplus' },
  ];

  readonly selectedQrBankInfo = computed(() => {
    const key = this.qrBankKey();
    return BANK_CODES[key] ?? BANK_CODES['MERCANTIL'];
  });

  readonly selectedCounterparty = computed(() => {
    const id = this.form().counterpartyId;
    return id ? this.crmService.getById(id) : null;
  });

  readonly marketPrices = computed<{ buy: number; sell: number }>(() => {
    const depth = this.binanceP2p.marketDepth();
    if (depth && (depth.bestBuyPrice > 0 || depth.bestSellPrice > 0)) {
      return {
        buy: depth.bestBuyPrice > 0 ? depth.bestBuyPrice : depth.bestSellPrice,
        sell: depth.bestSellPrice > 0 ? depth.bestSellPrice : depth.bestBuyPrice,
      };
    }
    const history = this.marketHistory.history();
    if (history.length > 0) {
      const latest = history[history.length - 1];
      if (latest.bestBuyPrice > 0 || latest.bestSellPrice > 0) {
        return {
          buy: roundMoney(latest.bestBuyPrice, 2),
          sell: roundMoney(latest.bestSellPrice, 2),
        };
      }
    }
    const parallel = this.finance360.currentParallelRate();
    if (parallel > 0) {
      return {
        buy: roundMoney(parallel * 0.992, 2),
        sell: roundMoney(parallel * 1.005, 2),
      };
    }
    return { buy: 0, sell: 0 };
  });

  readonly recommendedExitPrice = computed(() => {
    const base = this.openInventoryAvgPrice();
    if (base <= 0) return 0;
    return roundMoney(base * 1.01, 2);
  });

  readonly effectiveSpreadHint = computed(() => {
    const f = this.form();
    const avgInv = this.openInventoryAvgPrice();
    if (f.type === 'sell' && f.price > 0 && avgInv > 0) {
      const diffPct = ((f.price - avgInv) / avgInv) * 100;
      const netProfitVes = f.usdtAmount * (f.price - avgInv) - f.fees;
      return {
        isPositive: netProfitVes >= 0,
        label: `Vs. Costo FIFO (${avgInv.toFixed(2)} Bs): ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}% (${netProfitVes >= 0 ? '+' : ''}${netProfitVes.toFixed(2)} Bs neto)`,
      };
    }
    return null;
  });

  readonly selectedAccountTelemetry = computed(() => {
    const accId = this.form().bankAccountId;
    if (!accId) return null;
    const usage = this.accountsService.usages().find((u) => u.account.id === accId);
    const velocity = this.accountsService
      .accountVelocities()
      .find((v) => v.accountId === accId);
    if (!usage || !velocity) return null;
    return { usage, velocity };
  });

  readonly coherenceWarning = computed<string | null>(() => {
    const f = this.form();
    if (f.price > 0 && f.vesAmount > 0 && f.usdtAmount > 0) {
      const expectedVes = f.usdtAmount * f.price;
      const diffVes = Math.abs(f.vesAmount - expectedVes);
      const tolerance = Math.max(5, expectedVes * 0.015);
      if (diffVes > tolerance) {
        return `El monto VES (${f.vesAmount.toFixed(2)} Bs) difiere de ${f.usdtAmount} × ${f.price} = ${expectedVes.toFixed(2)} Bs por ${diffVes.toFixed(2)} Bs.`;
      }
    }
    return null;
  });

  readonly sopAudit = computed(() => {
    const f = this.form();
    const tri = this.antiTriangulation();
    const elapsedMinutes = Math.round(this.timer.elapsedMs() / 60000);
    return auditSopComplianceEnforcement({
      orderId: this.editingOpId() ?? 'DRAFT',
      accountHolderMatchesDocument: tri.riskLevel !== 'CRITICAL' && !tri.isThirdPartyPayment,
      bankBalanceConfirmedInAvailableFunds: !this.limitExceededWarning(),
      responseTimeMinutes: elapsedMinutes > 0 ? elapsedMinutes : 5,
      fundsReleasedBeforeBankVerification: false,
    });
  });

  readonly qrCodeUrl = signal<string>('');

  private readonly qrEffect = effect(() => {
    const cp = this.selectedCounterparty();
    const phone = cp?.phone || '04141234567';
    const doc = cp?.documentId || this.form().payerName || 'V12345678';
    const amt = this.form().vesAmount || 100;
    const bankInfo = this.selectedQrBankInfo();

    const payload: PagoMovilPayload = {
      bankCode: bankInfo.code,
      bankName: bankInfo.name,
      phone,
      documentId: doc,
      amountVes: amt,
    };

    const qrText = buildPagoMovilQrString(payload);
    void generateSimpleQrSvg(qrText).then((svg) => this.qrCodeUrl.set(svg));
  });

  toggleReconciler(): void {
    this.showReconciler.update((v) => !v);
  }

  toggleQrDispatcher(): void {
    this.showQrDispatcher.update((v) => !v);
  }

  toggleAutoCalc(): void {
    this.autoCalcMath.update((v) => !v);
  }

  onTypeChange(type: 'buy' | 'sell'): void {
    const patch: Partial<OpDraft> = { type };
    const mkt = this.marketPrices();
    if (this.form().price === 0 && (mkt.buy > 0 || mkt.sell > 0)) {
      patch.price = type === 'buy' ? mkt.buy : mkt.sell;
    }
    this.formChange.emit(patch);
  }

  onPriceInput(price: number): void {
    const f = this.form();
    const patch: Partial<OpDraft> = { price };
    if (this.autoCalcMath() && price > 0) {
      if (f.vesAmount > 0) {
        patch.usdtAmount = Number((f.vesAmount / price).toFixed(6));
      } else if (f.usdtAmount > 0) {
        patch.vesAmount = roundMoney(f.usdtAmount * price, 2);
      }
    }
    this.formChange.emit(patch);
  }

  onVesInput(vesAmount: number): void {
    const f = this.form();
    const patch: Partial<OpDraft> = { vesAmount };
    if (this.autoCalcMath() && vesAmount > 0) {
      if (f.price > 0) {
        patch.usdtAmount = Number((vesAmount / f.price).toFixed(6));
      } else if (f.usdtAmount > 0) {
        patch.price = roundMoney(vesAmount / f.usdtAmount, 2);
      }
    }
    this.formChange.emit(patch);
  }

  onCryptoInput(usdtAmount: number): void {
    const f = this.form();
    const patch: Partial<OpDraft> = { usdtAmount };
    if (this.autoCalcMath() && usdtAmount > 0) {
      if (f.price > 0) {
        patch.vesAmount = roundMoney(usdtAmount * f.price, 2);
      } else if (f.vesAmount > 0) {
        patch.price = roundMoney(f.vesAmount / usdtAmount, 2);
      }
    }
    this.formChange.emit(patch);
  }

  fillCryptoPct(pct: number): void {
    const total = this.openInventoryAmount();
    if (total <= 0) return;
    const amount = Number((total * pct).toFixed(4));
    this.onCryptoInput(amount);
  }

  fillCryptoAmount(val: number): void {
    this.onCryptoInput(val);
  }

  applyPricePreset(price: number): void {
    if (price <= 0) return;
    this.onPriceInput(price);
  }

  applyFeePct(pct: number): void {
    const ves = this.form().vesAmount;
    const fee = pct <= 0 ? 0 : roundMoney((ves * pct) / 100, 2);
    this.formChange.emit({ fees: fee });
  }

  reconcileMathDiscrepancy(): void {
    const f = this.form();
    if (f.price > 0 && f.usdtAmount > 0) {
      this.formChange.emit({ vesAmount: roundMoney(f.usdtAmount * f.price, 2) });
    }
  }

  refreshOrderbookPrice(): void {
    const asset = this.form().pair === 'EUR' ? 'USDT' : 'USDT';
    void this.binanceP2p.fetchMarketDepth(asset, 'VES').then((snap) => {
      if (snap) {
        const targetPrice =
          this.form().type === 'buy' ? snap.bestBuyPrice : snap.bestSellPrice;
        if (targetPrice > 0) {
          this.onPriceInput(targetPrice);
          this.toast.info(
            `Precio sincronizado desde el libro L2: ${targetPrice.toFixed(2)} Bs`,
            'Libro en Vivo',
          );
        }
      }
    });
  }

  autoRouteBestAccount(): void {
    const f = this.form();
    const cp = this.selectedCounterparty();
    let preferredBank: BankCode | undefined;

    if (cp && cp.bankAccounts && cp.bankAccounts.length > 0) {
      const upper = cp.bankAccounts.join(' ').toUpperCase();
      for (const entry of this.bankCodeEntries) {
        if (upper.includes(entry.key)) {
          preferredBank = entry.key as BankCode;
          break;
        }
      }
    }

    const recommended =
      getRotationRecommendation(
        this.accountsService.accounts(),
        this.accountsService.todayOperations(),
        f.type === 'buy' ? f.vesAmount : 0,
        undefined,
        preferredBank,
      ) ??
      getRotationRecommendation(
        this.accountsService.accounts(),
        this.accountsService.todayOperations(),
        f.type === 'buy' ? f.vesAmount : 0,
      );

    if (recommended) {
      this.onBankSelect(recommended.id);
      const vel = computeAccountVelocity(
        recommended,
        this.accountsService.todayOperations(),
      );
      this.toast.success(
        `Cuenta asignada: ${recommended.bankName} (${vel.todayTransactionCount}/${vel.maxDailyTransactions} ops hoy — ${vel.velocityHealth})`,
        'Enrutamiento SUDEBAN',
      );
    } else {
      this.toast.warn(
        'No se encontró una cuenta con cupo y velocidad óptima para este monto.',
        'Alerta de Liquidez',
      );
    }
  }

  onBankSelect(bankAccountId: string): void {
    this.formChange.emit({ bankAccountId });
    const acc = this.accountsService.getAccountById(bankAccountId);
    if (acc && acc.bankCode && BANK_CODES[acc.bankCode]) {
      this.qrBankKey.set(acc.bankCode);
    }
  }

  async pasteAndReconcileFromClipboard(): Promise<void> {
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText || !clipText.trim()) {
        this.showReconciler.set(true);
        this.toast.info(
          'El portapapeles está vacío. Pega el texto manualmente en el lector.',
          'Portapapeles',
        );
        return;
      }
      this.rawBankNotification.set(clipText.trim());
      this.showReconciler.set(true);
      this.processBankReceipt();
    } catch {
      this.showReconciler.set(true);
      this.toast.info(
        'Pega el comprobante en el campo del lector bancario para conciliar.',
        'Lector Activado',
      );
    }
  }

  processBankReceipt(): void {
    const raw = this.rawBankNotification().trim();
    if (!raw) {
      this.toast.error('Por favor ingresa el texto del comprobante bancario.', 'Texto Vacío');
      return;
    }

    const parsed = parseBankNotification(raw);
    const cp = this.selectedCounterparty();
    const expected = cp
      ? {
          orderId: 'CURRENT',
          expectedAmountVes: this.form().vesAmount > 0 ? this.form().vesAmount : 0,
          counterpartyId: cp.documentId,
          counterpartyName: cp.realName,
        }
      : undefined;

    const res = this.bankNotifier.ingest(raw, expected);
    this.unregisteredPayer.set(null);

    if (res.details.receivedAmountVes > 0) {
      const patch: Partial<OpDraft> = {
        vesAmount: res.details.receivedAmountVes,
      };

      const activePrice =
        this.form().price > 0
          ? this.form().price
          : this.form().type === 'sell'
            ? this.marketPrices().sell
            : this.marketPrices().buy;

      if (activePrice > 0) {
        patch.price = activePrice;
        patch.usdtAmount = Number((res.details.receivedAmountVes / activePrice).toFixed(6));
      }

      if (res.details.actualPayerId) {
        patch.payerName = res.details.actualPayerId;

        // Auto-match counterparty in CRM by normalized Cédula
        const normDoc = normalizeIdentityDoc(res.details.actualPayerId).replace(/[^0-9]/g, '');
        const matchedCp = this.crmService
          .counterparties()
          .find((c) => normalizeIdentityDoc(c.documentId).replace(/[^0-9]/g, '') === normDoc);

        if (matchedCp) {
          patch.counterpartyId = matchedCp.id;
        } else if (normDoc.length >= 6) {
          this.unregisteredPayer.set({
            documentId: res.details.actualPayerId,
            bankName: parsed.bankName || 'Pago Móvil',
            phone: parsed.senderPhone,
          });
        }
      }

      // Auto-select matching bank account from parsed notification bank
      if (parsed.bank !== 'UNKNOWN') {
        if (BANK_CODES[parsed.bank]) {
          this.qrBankKey.set(parsed.bank);
        }
        const matchingAcc = this.accountsService
          .accounts()
          .find((a) => a.bankCode === parsed.bank && a.status !== 'DISABLED');
        if (matchingAcc) {
          patch.bankAccountId = matchingAcc.id;
        }
      }

      if (res.details.reference) {
        patch.merchantNote = `Ref: ${res.details.reference}${res.details.actualPayerId ? ` (${res.details.actualPayerId})` : ''}`;
      }

      if (res.status === 'VERIFIED_SAFE') {
        patch.errorFree = true;
      }

      this.formChange.emit(patch);
    }
  }

  quickOnboardCounterparty(): void {
    const payer = this.unregisteredPayer();
    if (!payer) return;

    const created = this.crmService.addCounterparty({
      alias: `Cliente_${payer.documentId}`,
      realName: `Titular ${payer.documentId}`,
      documentId: payer.documentId,
      phone: payer.phone,
      bankAccounts: [payer.bankName],
      reputation: 'VERIFIED',
      notes: `Registrado automáticamente desde comprobante ${payer.bankName}.`,
    });

    this.unregisteredPayer.set(null);
    this.counterpartySelect.emit(created.id);
    this.toast.success(
      `Contraparte ${created.documentId} fichada en el CRM y vinculada a la operación.`,
      'Onboarding 1-Clic',
    );
  }

  resetForm(): void {
    this.formChange.emit({
      vesAmount: 0,
      usdtAmount: 0,
      price: 0,
      fees: 0,
      merchantNote: '',
      notes: '',
      payerName: '',
      counterpartyId: '',
      bankAccountId: '',
      errorFree: false,
    });
  }

  copy(text: string, label: string): void {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      this.toast.info(`${label} copiada al portapapeles: ${text}`, 'Copiado Rápido');
    });
  }

  clampMoney(v: number): number {
    return sharedClampMoney(v);
  }

  onFieldChange<K extends keyof OpDraft>(field: K, value: OpDraft[K]): void {
    this.formChange.emit({ [field]: value } as Partial<OpDraft>);
  }

  onCounterpartySelect(id: string): void {
    const cp = this.crmService.getById(id);
    if (cp && cp.bankAccounts && cp.bankAccounts.length > 0) {
      const upper = cp.bankAccounts.join(' ').toUpperCase();
      for (const entry of this.bankCodeEntries) {
        if (upper.includes(entry.key)) {
          this.qrBankKey.set(entry.key);
          break;
        }
      }
    }
    this.counterpartySelect.emit(id);
  }

  onSubmitForm(): void {
    this.submitForm.emit();
  }
}
