import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BinanceExecutionBridgeService } from '../../core/binance-execution-bridge.service';

@Component({
  selector: 'app-binance-operator-hud',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside
        class="binance-hud-bar"
        [style.right.px]="dockWidthPx()"
        role="region"
        aria-label="Barra operativa de ejecución Binance P2P"
      >
        <div class="hud-left">
          <span class="hud-dot" [class.is-dock]="dockOpen()"></span>
          @if (ctx(); as c) {
            <strong class="hud-merchant">{{ c.merchantName }}</strong>
            @if (c.price > 0) {
              <span class="hud-price">{{ c.price | number: '1.2-2' }} Bs</span>
            }
            @if (c.bank) {
              <span class="hud-chip">{{ c.bank }}</span>
            }
            @if (c.issues.length > 0) {
              <span class="hud-chip hud-warn" [title]="issuesSummary()">
                ⚠️ {{ c.issues.length }} aviso(s)
              </span>
            }
          } @else {
            <strong class="hud-merchant">Panel Operativo Binance P2P</strong>
          }
        </div>

        <div class="hud-actions">
          @if (ctx()?.copiedAmount) {
            <button
              type="button"
              class="hud-btn hud-primary"
              (click)="bridge.copyHudAmount()"
              title="Volver a copiar el monto calculado al portapapeles"
            >
              📋 Copiar {{ ctx()!.copiedAmount }}
            </button>
          }
          <button
            type="button"
            class="hud-btn"
            (click)="bridge.openMerchantPortal('myads')"
            title="Abrir Mis Anuncios para editar precios rápidamente"
          >
            Mis Anuncios
          </button>
          <button
            type="button"
            class="hud-btn"
            (click)="bridge.openMerchantPortal('advPost')"
            title="Abrir formulario de publicación en Binance P2P"
          >
            Publicar
          </button>
          @if (ctx() && ctx()!.price > 0) {
            <button
              type="button"
              class="hud-btn hud-log"
              (click)="bridge.sendActiveContextToLog()"
              title="Cargar esta operación en la Bitácora FIFO"
            >
              📝 Bitácora
            </button>
          }
          <button
            type="button"
            class="hud-btn"
            (click)="bridge.openActiveInExternalBrowser()"
            title="Abrir enlace en el navegador externo"
          >
            ↗
          </button>
          <button
            type="button"
            class="hud-btn hud-close"
            (click)="bridge.dismissHud()"
            aria-label="Cerrar panel de Binance P2P"
            title="Cerrar panel operativo"
          >
            ✕
          </button>
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .binance-hud-bar {
        position: fixed;
        bottom: 14px;
        left: 16px;
        z-index: 950;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 14px;
        border-radius: 14px;
        background: color-mix(in srgb, var(--panel, #111827) 92%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent, #22c55e) 45%, var(--line, #2a3441));
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(14px);
        color: var(--text, #f8fafc);
        font-size: 0.78rem;
      }

      .hud-left,
      .hud-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 7px;
      }

      .hud-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--gold, #eab308);
      }

      .hud-dot.is-dock {
        background: var(--accent, #22c55e);
        box-shadow: 0 0 8px var(--accent, #22c55e);
      }

      .hud-price {
        font-family: var(--font-mono, monospace);
        font-weight: 800;
        color: var(--accent, #22c55e);
      }

      .hud-chip {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--panel-2, rgba(255, 255, 255, 0.08));
        border: 1px solid var(--line, rgba(255, 255, 255, 0.14));
        font-size: 0.7rem;
      }

      .hud-warn {
        color: var(--gold, #facc15);
        border-color: color-mix(in srgb, var(--gold, #facc15) 45%, transparent);
      }

      .hud-btn {
        border: 1px solid var(--line-strong, rgba(255, 255, 255, 0.18));
        background: var(--panel-2, rgba(255, 255, 255, 0.07));
        color: var(--text, #f8fafc);
        border-radius: 8px;
        padding: 5px 9px;
        font-size: 0.72rem;
        font-weight: 700;
        cursor: pointer;
      }

      .hud-primary {
        background: color-mix(in srgb, var(--accent, #22c55e) 22%, var(--panel-2, #1f2937));
        border-color: color-mix(in srgb, var(--accent, #22c55e) 55%, transparent);
      }

      .hud-close {
        padding: 5px 8px;
        opacity: 0.85;
      }
    `,
  ],
})
export class BinanceOperatorHudComponent {
  readonly bridge = inject(BinanceExecutionBridgeService);

  readonly ctx = this.bridge.activeHudContext;
  readonly dockOpen = computed(() => this.bridge.dockState().isOpen);
  readonly dockWidthPx = computed(() =>
    this.dockOpen() ? this.bridge.dockState().widthPx + 14 : 16,
  );
  readonly visible = computed(() => this.ctx() !== null || this.dockOpen());
  readonly issuesSummary = computed(() =>
    (this.ctx()?.issues ?? []).map((i) => i.message).join(' · '),
  );
}
