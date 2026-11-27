import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import type { FxDeskEvaluationPlan } from '@p2p/core';

@Component({
  selector: 'app-fx-kpi-strip',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../styles/_fx-desk-glass-tokens.scss'],
  styles: [
    `
      .kpi-bento-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .kpi-eyebrow {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 0.69rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--fx-muted);
      }
      .kpi-primary-row {
        position: relative;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 7px;
        font-size: 1.35rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .kpi-unit {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--fx-muted);
      }
      .kpi-foot {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 0.72rem;
        color: var(--fx-muted);
      }
      .kpi-accent-text {
        color: var(--fx-accent);
      }
      .kpi-gold-text {
        color: var(--fx-gold);
      }
      .kpi-cyan-text {
        color: var(--fx-accent-2);
      }
      @media (max-width: 1180px) {
        .kpi-bento-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .kpi-bento-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
  template: `
    <section class="kpi-bento-grid" aria-label="Indicadores clave de Mesa Cambiaria BCV">
      <!-- KPI 1: Poder de Compra Real -->
      <article class="fx-kpi-aura tone-gold">
        <div class="kpi-eyebrow">
          <span>Poder de Compra BCV</span>
          <span>{{ simulatorActive() ? 'SIMULADOR' : 'TESORERÍA REAL' }}</span>
        </div>
        <div class="kpi-primary-row fx-mono">
          <span>\${{ plan().totalRecommendedUsd | number: '1.0-0' }}</span>
          <span class="kpi-unit">USD</span>
        </div>
        <div class="kpi-foot fx-tabular">
          <span>Bs. {{ plan().totalDeployableVes | number: '1.2-2' }} desplegables</span>
          <strong class="kpi-gold-text">{{ viableCount() }}/14 listos</strong>
        </div>
      </article>

      <!-- KPI 2: Utilidad Neta Post-IGTF & Riel -->
      <article class="fx-kpi-aura tone-emerald">
        <div class="kpi-eyebrow">
          <span>Utilidad Neta Post-IGTF</span>
          <span>IGTF {{ igtfPct() | number: '1.1-1' }}%</span>
        </div>
        <div class="kpi-primary-row fx-mono kpi-accent-text">
          @if (plan().totalProjectedNetProfitVes !== null) {
            <span>+Bs. {{ plan().totalProjectedNetProfitVes | number: '1.0-0' }}</span>
          } @else {
            <span style="color: var(--fx-muted)">Sin feed</span>
          }
        </div>
        <div class="kpi-foot fx-tabular">
          <span>
            ROI Neto:
            <strong>
              {{
                plan().averageNetRoiPct !== null
                  ? '+' + (plan().averageNetRoiPct | number: '1.2-2') + '%'
                  : 'n/d'
              }}
            </strong>
          </span>
          <strong class="kpi-accent-text">{{ plan().totalNetUsdt | number: '1.2-2' }} USDT</strong>
        </div>
      </article>

      <!-- KPI 3: Velocidad SUDEBAN & Cupo Mensual -->
      <article class="fx-kpi-aura tone-violet">
        <div class="kpi-eyebrow">
          <span>Salud & Cupos SUDEBAN</span>
          <span>CORTE 00:00 VET</span>
        </div>
        <div class="kpi-primary-row fx-mono">
          <span>{{ linkedTransferAccountsCount() }}</span>
          <span class="kpi-unit">Cuentas Transf.</span>
        </div>
        <div class="kpi-foot fx-tabular">
          <span>Aislamiento anti-sobregiro activo</span>
          <strong style="color: var(--fx-violet)">
            {{ overLimitCount() === 0 ? '✓ Óptimo' : overLimitCount() + ' al tope' }}
          </strong>
        </div>
      </article>

      <!-- KPI 4: Liquidación FIFO Hoy (USD Banco vs USDT Neto separado) -->
      <article class="fx-kpi-aura tone-cyan">
        <div class="kpi-eyebrow">
          <span>Liquidado Hoy en FIFO</span>
          <span>SQLite WAL</span>
        </div>
        <div class="kpi-primary-row fx-mono">
          <span>\${{ settledTodayUsd() | number: '1.0-0' }}</span>
          <span class="kpi-unit">→</span>
          <span class="kpi-cyan-text">{{ settledTodayNetUsdt() | number: '1.2-2' }}</span>
          <span class="kpi-unit">USDT</span>
        </div>
        <div class="kpi-foot fx-tabular">
          <span>USD banco vs USDT neto separado</span>
          <strong class="kpi-cyan-text">{{ settledTodayOpsCount() }} pactos</strong>
        </div>
      </article>
    </section>
  `,
})
export class FxKpiStripComponent {
  readonly plan = input.required<FxDeskEvaluationPlan>();
  readonly viableCount = input.required<number>();
  readonly igtfPct = input.required<number>();
  readonly simulatorActive = input.required<boolean>();
  readonly linkedTransferAccountsCount = input.required<number>();
  readonly overLimitCount = input.required<number>();
  readonly settledTodayUsd = input.required<number>();
  readonly settledTodayNetUsdt = input.required<number>();
  readonly settledTodayOpsCount = input.required<number>();
}
