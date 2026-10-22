import {
  ChangeDetectionStrategy,
  Component,
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
    <div class="terminal-input-card">
      <div class="terminal-card-header" style="flex-wrap: wrap; gap: 8px;">
        <div class="card-header-title">
          <span class="card-icon">{{ editingOpId() ? '✏️' : '⚡' }}</span>
          <span class="card-title">
            {{ editingOpId() ? 'Editando Operación en Libro Mayor' : 'Nueva Operación en Libro Mayor' }}
          </span>
          @if (editingOpId()) {
            <span class="badge badge-gold font-mono" style="font-size: 0.7rem; margin-left: 6px;">
              MODO EDICIÓN
            </span>
          }
        </div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
          <button
            type="button"
            class="btn btn-secondary"
            style="font-size: 0.76rem; padding: 4px 10px; border-color: var(--accent); color: var(--accent);"
            (click)="pasteAndReconcileFromClipboard()"
            title="Lee el SMS/comprobante directo de tu portapapeles, concilia y rellena el formulario"
          >
            📋 Pegar y Conciliar (1-Clic)
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            style="font-size: 0.76rem; padding: 4px 10px;"
            (click)="toggleReconciler()"
          >
            📥 {{ showReconciler() ? 'Ocultar Lector' : 'Lector Manual SMS' }}
          </button>
          @if (form().type === 'buy') {
            <button
              type="button"
              class="btn btn-secondary"
              style="font-size: 0.76rem; padding: 4px 10px; border-color: var(--gold);"
              (click)="toggleQrDispatcher()"
            >
              📲 {{ showQrDispatcher() ? 'Ocultar QR' : 'QR Pago Móvil' }}
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost"
            style="font-size: 0.74rem; padding: 4px 8px;"
            [style.color]="autoCalcMath() ? 'var(--accent)' : 'var(--muted)'"
            (click)="toggleAutoCalc()"
            title="Activa o pausa el cálculo bidireccional automático entre Precio, VES y USDT"
          >
            {{ autoCalcMath() ? '🔗 Auto-Cálculo: ON' : '⛓️‍💥 Auto-Cálculo: OFF' }}
          </button>
        </div>
      </div>

      <!-- Panel de Ingesta y Conciliación Pasiva -->
      @if (showReconciler()) {
        <div
          style="background: rgba(10, 15, 26, 0.75); border: 1px solid var(--gold-border); border-radius: var(--radius); padding: 14px; margin-bottom: 10px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;"
          >
            <span
              style="font-size: 0.8rem; font-weight: 700; color: var(--gold-strong); text-transform: uppercase; letter-spacing: 0.5px;"
            >
              Lector Inteligente de Notificaciones (Mercantil, Bancamiga, Banesco, Provincial, BDV, BNC, Bancaribe, Banplus)
            </span>
            <span class="text-muted" style="font-size: 0.74rem;"
              >Auto-Detección de Banco + Cédula CRM + Anti-Triangulación</span
            >
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input
              type="text"
              placeholder="Pega aquí el SMS o correo del banco (ej: MERCANTIL: Recibiste Pago Movil por Bs. 2.450,00 de CI: V18450123 Ref: 987654)"
              [value]="rawBankNotification()"
              (input)="rawBankNotification.set($any($event.target).value)"
              style="flex: 1; min-width: 260px; font-size: 0.85rem;"
            />
            <button
              type="button"
              class="btn btn-primary"
              (click)="processBankReceipt()"
              style="font-size: 0.82rem; white-space: nowrap;"
            >
              ⚡ Conciliar y Rellenar
            </button>
          </div>

          @if (bankNotifier.lastReconciliation(); as rec) {
            <div
              style="margin-top: 10px; padding: 10px 12px; border-radius: 6px; font-size: 0.82rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;"
              [style.background]="
                rec.status === 'VERIFIED_SAFE'
                  ? 'rgba(52, 211, 153, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)'
              "
              [style.color]="rec.status === 'VERIFIED_SAFE' ? '#34d399' : '#f87171'"
              [style.border-left]="
                rec.status === 'VERIFIED_SAFE' ? '3px solid #34d399' : '3px solid #ef4444'
              "
            >
              <span>{{ rec.message }}</span>
              @if (unregisteredPayer(); as newPayer) {
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.74rem; padding: 3px 10px; border-color: var(--accent); color: var(--accent); background: rgba(15, 23, 42, 0.85);"
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
          style="background: rgba(10, 15, 26, 0.75); border: 1px solid rgba(47, 208, 143, 0.35); border-radius: var(--radius); padding: 14px; margin-bottom: 10px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;"
          >
            <span
              style="font-size: 0.8rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px;"
            >
              📲 Despachador QR Pago Móvil ({{ selectedQrBankInfo().name }} — {{ selectedQrBankInfo().code }})
            </span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              @for (b of bankCodeEntries; track b.key) {
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="font-size: 0.7rem; padding: 2px 6px; border: 1px solid var(--border);"
                  [style.borderColor]="qrBankKey() === b.key ? 'var(--accent)' : 'var(--border)'"
                  [style.color]="qrBankKey() === b.key ? 'var(--accent)' : 'var(--muted)'"
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
                style="background: #fff; padding: 8px; border-radius: 6px; display: inline-flex;"
              >
                <img
                  [src]="svg"
                  alt="QR Pago Móvil"
                  style="width: 130px; height: 130px; display: block;"
                />
              </div>
            }
            <div
              style="display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 220px;"
            >
              <div style="font-size: 0.83rem; color: var(--muted);">
                Escanea con la app de tu banco o copia los datos exactos de transferencia con 1 clic:
              </div>

              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.76rem; padding: 4px 8px;"
                  (click)="copy(selectedQrBankInfo().code, 'Banco')"
                >
                  🏦 Banco: {{ selectedQrBankInfo().code }} ({{ selectedQrBankInfo().name }})
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.76rem; padding: 4px 8px;"
                  (click)="
                    copy(selectedCounterparty()?.documentId || form().payerName || '', 'Cédula')
                  "
                >
                  📋 Cédula: {{ selectedCounterparty()?.documentId || form().payerName || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.76rem; padding: 4px 8px;"
                  (click)="copy(selectedCounterparty()?.phone || '', 'Teléfono')"
                >
                  📋 Teléfono: {{ selectedCounterparty()?.phone || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.76rem; padding: 4px 8px;"
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
            <label class="terminal-label" for="op-field-price" style="display: flex; justify-content: space-between; align-items: center;">
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
            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
              @if (marketPrices().buy > 0) {
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid rgba(47, 208, 143, 0.3); color: var(--accent);"
                  (click)="applyPricePreset(marketPrices().buy)"
                  title="Aplicar precio de punta Compra actual"
                >
                  🟢 Compra {{ marketPrices().buy | num }}
                </button>
              }
              @if (marketPrices().sell > 0) {
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid rgba(255, 95, 109, 0.3); color: #f87171;"
                  (click)="applyPricePreset(marketPrices().sell)"
                  title="Aplicar precio de punta Venta actual"
                >
                  🔴 Venta {{ marketPrices().sell | num }}
                </button>
              }
              @if (openInventoryAvgPrice() > 0) {
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid var(--gold-border); color: var(--gold);"
                  (click)="applyPricePreset(recommendedExitPrice())"
                  title="Precio promedio FIFO de tu inventario abierto + 1.0% de margen seguro"
                >
                  ⚖️ Salida +1%: {{ recommendedExitPrice() | num }}
                </button>
              }
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.68rem; padding: 2px 6px;"
                (click)="refreshOrderbookPrice()"
                title="Actualizar precios en vivo desde Binance P2P"
              >
                🔄 L2
              </button>
            </div>
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
            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid var(--border);"
                (click)="applyFeePct(0)"
              >
                0% Mismo Banco
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid var(--border);"
                (click)="applyFeePct(0.3)"
                title="Comisión Pago Móvil interbancario (0.3%)"
              >
                0.3% PM Inter
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.68rem; padding: 2px 6px; border: 1px solid var(--border);"
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
            <label class="terminal-label" for="op-field-bank" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Cuenta Bancaria / Riel</span>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.68rem; padding: 1px 6px; color: var(--accent); border: 1px solid rgba(47, 208, 143, 0.35);"
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
                  class="badge font-mono"
                  style="font-size: 0.65rem; padding: 1px 5px;"
                  [style.background]="
                    tel.velocity.velocityHealth === 'OPTIMAL'
                      ? 'rgba(47, 208, 143, 0.15)'
                      : tel.velocity.velocityHealth === 'SATURATED'
                        ? 'rgba(255, 95, 109, 0.2)'
                        : 'rgba(234, 179, 8, 0.2)'
                  "
                  [style.color]="
                    tel.velocity.velocityHealth === 'OPTIMAL'
                      ? 'var(--accent)'
                      : tel.velocity.velocityHealth === 'SATURATED'
                        ? 'var(--danger)'
                        : 'var(--gold)'
                  "
                >
                  SUDEBAN: {{ tel.velocity.todayTransactionCount }}/{{ tel.velocity.maxDailyTransactions }} ops ({{ tel.velocity.velocityHealth }})
                </span>
              </div>
            }
          </div>

          <div class="terminal-field full-width">
            <label class="terminal-label" for="op-field-note">
              <span>Notas del Comercio / Referencia Bancaria</span>
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
            style="background: rgba(255, 95, 109, 0.16); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; color: var(--danger); margin: 10px 0 6px;"
            role="alert"
          >
            🚨 <strong>ALERTA ANTI-REPLAY (REFERENCIA DUPLICADA):</strong> {{ dupWarn }}
          </div>
        }

        @if (coherenceWarning(); as cohWarn) {
          <div
            style="background: rgba(234, 179, 8, 0.14); border-left: 4px solid var(--gold); padding: 10px 14px; border-radius: 6px; font-size: 0.83rem; color: var(--gold-strong); margin: 8px 0 6px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;"
            role="alert"
          >
            <span>⚠️ <strong>DESCALCE MATEMÁTICO (FAT-FINGER):</strong> {{ cohWarn }}</span>
            <button
              type="button"
              class="btn btn-secondary"
              style="font-size: 0.74rem; padding: 3px 8px;"
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
            style="padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; margin: 12px 0 6px;"
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
            style="background: rgba(255, 95, 109, 0.12); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; color: var(--danger); margin: 6px 0;"
            role="alert"
          >
            ⚠️ {{ warn }}
          </div>
        }

        @if (form().receiptImage) {
          <div
            style="background: rgba(16, 185, 129, 0.08); border: 1px solid var(--accent); padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; display: flex; align-items: center; justify-content: space-between; margin-top: 10px;"
          >
            <span style="display: flex; align-items: center; gap: 6px; color: var(--accent);">
              📸 <strong>Comprobante Bancario Adjunto:</strong> {{ form().receiptReference || 'Captura vinculada' }}
            </span>
            <button
              type="button"
              class="btn btn-ghost"
              style="padding: 2px 8px; font-size: 0.72rem; border: 1px solid var(--accent); color: var(--accent);"
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
                style="max-height: 220px; max-width: 100%; border-radius: 6px; border: 1px solid var(--border); object-fit: contain;"
              />
            </div>
          }
        }

        <div class="terminal-card-footer" style="padding-top: 14px; margin-top: 10px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="checkbox-label" style="margin: 0;">
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
              class="badge font-mono"
              style="font-size: 0.7rem; padding: 3px 8px;"
              [style.background]="sopAudit().isCompliant ? 'rgba(47, 208, 143, 0.15)' : 'rgba(234, 179, 8, 0.18)'"
              [style.color]="sopAudit().isCompliant ? 'var(--accent)' : 'var(--gold)'"
              [title]="sopAudit().summary"
            >
              🛡️ SOP Score: {{ sopAudit().complianceScore }}%
            </span>
          </div>
          <div class="form-actions" style="margin: 0; display: flex; gap: 8px;">
            @if (editingOpId()) {
              <button
                type="button"
                class="btn btn-ghost"
                (click)="cancelEdit.emit()"
              >
                Cancelar Edición
              </button>
            }
            <button type="button" class="btn btn-ghost" (click)="resetForm()" style="font-size: 0.8rem;">
              Limpiar
            </button>
            <button type="submit" class="btn btn-primary">
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
  readonly unregisteredPayer = signal<{
    documentId: string;
    bankName: string;
    phone?: string;
  } | null>(null);

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
