import { Component, signal, output, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

export interface TourCard {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  image: string;
  metrics: { label: string; val: string; desc: string }[];
  quote: string;
  actionText: string;
  actionRoute: string;
}

export const TOUR_CARDS: TourCard[] = [
  {
    id: 'cockpit',
    badge: '01 / RENTABILIDAD NETA',
    title: 'Cockpit Cuantitativo & Regla de Oro',
    subtitle: 'Cálculo del spread neto real descontando comisiones de exchange y fricción bancaria.',
    image: 'assets/showcase/card-1-cockpit.jpg',
    metrics: [
      { label: 'Regla de Oro', val: '≥ 0.50% Neto', desc: 'Filtro automático de viabilidad' },
      { label: 'Brecha BCV vs Paralelo', val: 'Monitoreo en Vivo', desc: 'Detección de arbitraje y ventana oficial' },
      { label: 'Costo Oculto', val: 'Cero Sorpresas', desc: 'Deducción de comisiones Maker/Taker' },
    ],
    quote: 'Si no medís comisiones y fricción bancaria, no sabés si estás ganando o perdiendo.',
    actionText: 'Probar Monitor de Spread en Vivo →',
    actionRoute: '/spread',
  },
  {
    id: 'shield',
    badge: '02 / SEGURIDAD BANCARIA',
    title: 'Escudo Bancario & OCR Forense',
    subtitle: 'Auditoría instantánea de Pago Móvil y monitoreo de velocidad anti-bloqueo SUDEBAN.',
    image: 'assets/showcase/card-2-bank-shield.jpg',
    metrics: [
      { label: 'Auditoría OCR', val: '2 Segundos', desc: 'Validación de titular, cédula y monto' },
      { label: 'Anti-Triangulación', val: 'Verificación 1:1', desc: 'Cero liberación a cuentas de terceros' },
      { label: 'Semáforo SUDEBAN', val: 'Rotación Preventiva', desc: 'Evita bloqueo por saturación de cupo' },
    ],
    quote: 'Blindaje total contra fraudes de terceros y cierres de cuenta por SUDEBAN.',
    actionText: 'Probar Auditoría de Comprobantes OCR →',
    actionRoute: '/receipts',
  },
  {
    id: 'copilot',
    badge: '03 / INTELIGENCIA ARTIFICIAL',
    title: 'Copiloto IA & Ecosistema MCP (52 Tools)',
    subtitle: 'Estratega de banca privada con 52 herramientas cuantitativas y planes en 1 clic.',
    image: 'assets/showcase/card-3-copilot-mcp.jpg',
    metrics: [
      { label: 'Herramientas MCP', val: '52 Conectadas', desc: 'Microestructura, macro BCV y arbitraje' },
      { label: 'Planes Tácticos', val: '1-Click Play', desc: 'SOP, cobertura delta-neutral y Earn' },
      { label: 'Transparencia', val: 'Honestidad de Datos', desc: 'Rótulos claros [EN VIVO] / [SIMULADO]' },
    ],
    quote: 'Tu estratega de banca privada y analista cuantitativo sentado al lado tuyo 24/7.',
    actionText: 'Abrir el Copiloto IA →',
    actionRoute: '/copilot',
  },
  {
    id: 'governance',
    badge: '04 / GOBERNANZA & CONTROL',
    title: 'Gobernanza Institucional & Kill-Switch',
    subtitle: 'Interbloqueo de emergencia en el proceso principal y trazabilidad inmutable.',
    image: 'assets/showcase/card-4-killswitch.jpg',
    metrics: [
      { label: 'Kill-Switch', val: 'Interbloqueo Main', desc: 'Parada sincrónica ante emergencias' },
      { label: 'Trazabilidad', val: 'SQLite Journal', desc: 'Registro inmutable de cada decisión' },
      { label: 'Human-in-the-Loop', val: 'Supervisión Humana', desc: 'La máquina propone, el operador aprueba' },
    ],
    quote: 'Protección del capital primero. La máquina nunca arriesga sin supervisión humana.',
    actionText: 'Ver Parámetros de Riesgo & Kill-Switch →',
    actionRoute: '/risk',
  },
];

@Component({
  selector: 'app-product-tour-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="tour-backdrop"
      role="button"
      tabindex="0"
      (click)="$event.target === $event.currentTarget && close()"
      aria-label="Cerrar tour de producto"
    >
      <div
        class="tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-dialog-heading"
        tabindex="-1"
      >
        <!-- Dialog Header -->
        <div class="tour-header">
          <div class="header-left">
            <span class="brand-pill">💎 P2P DECISOR · SHOWCASE INSTITUCIONAL</span>
            <h2 id="tour-dialog-heading">Terminal de Tesorería, Arbitraje & Mitigación de Riesgo</h2>
            <p class="header-subtitle">
              Recorrido ejecutivo por los 4 pilares fundamentales de la plataforma para mesas OTC e inversores
            </p>
          </div>
          <button class="btn-close" (click)="close()" aria-label="Cerrar modal de presentación">&times;</button>
        </div>

        <!-- Pillar Selector Tabs -->
        <nav class="tour-tabs" aria-label="Pilares del producto">
          @for (card of cards; track card.id; let i = $index) {
            <button
              type="button"
              class="tab-btn"
              [class.active]="activeIdx() === i"
              (click)="selectCard(i)"
            >
              <span class="tab-index">{{ i + 1 }}</span>
              <span class="tab-title">{{ card.title.split('&')[0].trim() }}</span>
            </button>
          }
        </nav>

        <!-- Active Card Showcase Viewport -->
        <div class="tour-body">
          @let current = cards[activeIdx()];

          <div class="card-hero-grid">
            <!-- Visual Graphic Render -->
            <div class="card-visual">
              <div class="image-wrapper">
                <img [src]="current.image" [alt]="current.title" class="hero-image" />
                <div class="badge-overlay">{{ current.badge }}</div>
              </div>
            </div>

            <!-- Content & Selling Arguments -->
            <div class="card-details">
              <div class="card-tag">{{ current.badge }}</div>
              <h3 class="card-title">{{ current.title }}</h3>
              <p class="card-subtitle">{{ current.subtitle }}</p>

              <!-- Value Metrics -->
              <div class="metrics-container">
                @for (m of current.metrics; track m.label) {
                  <div class="metric-pill">
                    <span class="metric-val">{{ m.val }}</span>
                    <span class="metric-lbl">{{ m.label }}</span>
                    <span class="metric-desc">{{ m.desc }}</span>
                  </div>
                }
              </div>

              <!-- Value Quote -->
              <blockquote class="card-quote">
                <span class="quote-mark">“</span>
                <em>{{ current.quote }}</em>
              </blockquote>

              <!-- Interactive Live Action -->
              <div class="card-actions">
                <button type="button" class="btn-live-action" (click)="navigateAndClose(current.actionRoute)">
                  {{ current.actionText }}
                </button>
                <div class="nav-controls">
                  <button
                    type="button"
                    class="btn-nav"
                    [disabled]="activeIdx() === 0"
                    (click)="prev()"
                    title="Anterior pilar"
                  >
                    ← Anterior
                  </button>
                  <span class="step-indicator">{{ activeIdx() + 1 }} / {{ cards.length }}</span>
                  <button
                    type="button"
                    class="btn-nav"
                    [disabled]="activeIdx() === cards.length - 1"
                    (click)="next()"
                    title="Siguiente pilar"
                  >
                    Siguiente →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Bar with Direct Hook & Pilot Pitch -->
        <div class="tour-footer">
          <div class="footer-note">
            <span class="pulse-indicator"></span>
            <span>
              <strong>Propuesta Comercial:</strong> Piloto institucional de 14 días con monitoreo de spread neto y auditoría de cuentas sin costo de integración.
            </span>
          </div>
          <button type="button" class="btn-close-footer" (click)="close()">
            Entendido, cerrar presentación
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tour-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 4, 8, 0.82);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .tour-dialog {
      background: #0d0d14;
      border: 0.5px solid rgba(255, 255, 255, 0.14);
      border-radius: 20px;
      width: 100%;
      max-width: 1040px;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 214, 10, 0.1);
      overflow: hidden;
      color: #ffffff;
      font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif);
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .tour-header {
      padding: 1.25rem 1.5rem 1rem;
      border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;

      .brand-pill {
        display: inline-block;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        color: var(--gold, #ffd60a);
        background: rgba(255, 214, 10, 0.12);
        padding: 3px 8px;
        border-radius: 9999px;
        border: 0.5px solid rgba(255, 214, 10, 0.3);
        margin-bottom: 6px;
      }

      h2 {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #ffffff;
      }

      .header-subtitle {
        margin: 4px 0 0;
        font-size: 0.82rem;
        color: var(--muted, rgba(235, 235, 245, 0.6));
      }

      .btn-close {
        background: transparent;
        border: none;
        color: var(--muted, rgba(235, 235, 245, 0.6));
        font-size: 1.6rem;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 8px;
        transition: all 0.2s ease;

        &:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }
      }
    }

    .tour-tabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);

      .tab-btn {
        background: rgba(255, 255, 255, 0.04);
        border: 0.5px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        color: var(--muted, rgba(235, 235, 245, 0.65));
        font-size: 0.8rem;
        font-weight: 600;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        text-align: left;

        .tab-index {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 800;
          flex-shrink: 0;
        }

        .tab-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        &:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
        }

        &.active {
          background: rgba(255, 214, 10, 0.15);
          border-color: rgba(255, 214, 10, 0.45);
          color: var(--gold, #ffd60a);
          box-shadow: 0 4px 12px rgba(255, 214, 10, 0.15);

          .tab-index {
            background: var(--gold, #ffd60a);
            color: #000000;
          }
        }
      }
    }

    .tour-body {
      padding: 1.25rem 1.5rem;
      overflow-y: auto;
      flex: 1;

      .card-hero-grid {
        display: grid;
        grid-template-columns: 1.15fr 1fr;
        gap: 1.5rem;
        align-items: center;

        @media (max-width: 860px) {
          grid-template-columns: 1fr;
        }
      }

      .card-visual {
        .image-wrapper {
          position: relative;
          border-radius: 14px;
          overflow: hidden;
          border: 0.5px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
          background: #000000;

          .hero-image {
            width: 100%;
            height: auto;
            display: block;
            aspect-ratio: 16 / 9;
            object-fit: cover;
            transition: transform 0.4s ease;
          }

          .badge-overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(13, 13, 20, 0.85);
            backdrop-filter: blur(8px);
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.65rem;
            font-weight: 800;
            color: var(--gold, #ffd60a);
            border: 0.5px solid rgba(255, 214, 10, 0.35);
          }
        }
      }

      .card-details {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;

        .card-tag {
          font-size: 0.7rem;
          font-weight: 800;
          color: var(--gold, #ffd60a);
          letter-spacing: 0.05em;
        }

        .card-title {
          margin: 0;
          font-size: 1.45rem;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: -0.02em;
        }

        .card-subtitle {
          margin: 0;
          font-size: 0.88rem;
          line-height: 1.45;
          color: var(--muted, rgba(235, 235, 245, 0.75));
        }

        .metrics-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-top: 4px;

          @media (max-width: 500px) {
            grid-template-columns: 1fr;
          }

          .metric-pill {
            background: rgba(255, 255, 255, 0.04);
            border: 0.5px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 2px;

            .metric-val {
              font-size: 0.92rem;
              font-weight: 800;
              color: var(--accent, #30d158);
              font-family: var(--font-mono, monospace);
            }

            .metric-lbl {
              font-size: 0.72rem;
              font-weight: 700;
              color: #f1f5f9;
            }

            .metric-desc {
              font-size: 0.65rem;
              color: var(--muted, rgba(235, 235, 245, 0.55));
              line-height: 1.25;
            }
          }
        }

        .card-quote {
          margin: 4px 0 0;
          padding: 8px 12px;
          background: rgba(255, 214, 10, 0.06);
          border-left: 3px solid var(--gold, #ffd60a);
          border-radius: 0 8px 8px 0;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.88);
          position: relative;

          .quote-mark {
            font-size: 1.2rem;
            color: var(--gold, #ffd60a);
            margin-right: 4px;
            line-height: 0;
            vertical-align: -2px;
          }
        }

        .card-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-top: 6px;
          flex-wrap: wrap;

          .btn-live-action {
            background: linear-gradient(135deg, #0a84ff 0%, #0066cc 100%);
            border: none;
            color: #ffffff;
            font-size: 0.82rem;
            font-weight: 700;
            padding: 10px 16px;
            border-radius: 10px;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(10, 132, 255, 0.35);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

            &:hover {
              filter: brightness(1.1);
              transform: translateY(-1px);
              box-shadow: 0 6px 18px rgba(10, 132, 255, 0.45);
            }
          }

          .nav-controls {
            display: flex;
            align-items: center;
            gap: 8px;

            .btn-nav {
              background: rgba(255, 255, 255, 0.06);
              border: 0.5px solid rgba(255, 255, 255, 0.12);
              color: var(--muted, #cbd5e1);
              font-size: 0.75rem;
              font-weight: 600;
              padding: 6px 10px;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s ease;

              &:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.12);
                color: #ffffff;
              }

              &:disabled {
                opacity: 0.3;
                cursor: not-allowed;
              }
            }

            .step-indicator {
              font-size: 0.75rem;
              font-family: var(--font-mono, monospace);
              color: var(--muted, rgba(235, 235, 245, 0.6));
              padding: 0 4px;
            }
          }
        }
      }
    }

    .tour-footer {
      padding: 0.75rem 1.5rem;
      background: rgba(0, 0, 0, 0.3);
      border-top: 0.5px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;

      .footer-note {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.78rem;
        color: var(--muted, rgba(235, 235, 245, 0.7));

        .pulse-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent, #30d158);
          box-shadow: 0 0 8px var(--accent, #30d158);
          flex-shrink: 0;
        }

        strong {
          color: #ffffff;
        }
      }

      .btn-close-footer {
        background: transparent;
        border: 0.5px solid rgba(255, 255, 255, 0.15);
        color: var(--muted, #94a3b8);
        font-size: 0.78rem;
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { transform: translateY(16px) scale(0.98); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    @media (max-width: 768px) {
      .tour-backdrop {
        padding: 0.25rem;
      }

      .tour-dialog {
        border-radius: 14px;
        max-height: 98vh;
      }

      .tour-header {
        padding: 0.75rem 1rem 0.5rem;
        h2 { font-size: 1.1rem; }
      }

      .tour-tabs {
        display: flex;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 0.5rem 0.75rem;
        gap: 6px;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }

        .tab-btn {
          flex-shrink: 0;
          padding: 6px 10px;
          font-size: 0.75rem;
        }
      }

      .tour-body {
        padding: 0.75rem 1rem;

        .card-hero-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .card-details {
          .card-title {
            font-size: 1.15rem;
          }

          .metrics-container {
            grid-template-columns: 1fr;
            gap: 6px;
          }

          .card-actions {
            flex-direction: column;
            align-items: stretch;

            .btn-live-action {
              width: 100%;
              justify-content: center;
              min-height: 44px;
              text-align: center;
            }

            .nav-controls {
              justify-content: space-between;
              width: 100%;
            }
          }
        }
      }

      .tour-footer {
        padding: 0.5rem 1rem;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;

        .btn-close-footer {
          width: 100%;
          text-align: center;
          min-height: 38px;
        }
      }
    }
  `],
})
export class ProductTourModalComponent {
  readonly cards = TOUR_CARDS;
  readonly activeIdx = signal<number>(0);
  readonly modalClose = output<void>();

  private readonly router = inject(Router);

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    } else if (event.key === 'ArrowRight') {
      this.next();
    } else if (event.key === 'ArrowLeft') {
      this.prev();
    }
  }

  selectCard(index: number): void {
    if (index >= 0 && index < this.cards.length) {
      this.activeIdx.set(index);
    }
  }

  next(): void {
    if (this.activeIdx() < this.cards.length - 1) {
      this.activeIdx.update((i) => i + 1);
    }
  }

  prev(): void {
    if (this.activeIdx() > 0) {
      this.activeIdx.update((i) => i - 1);
    }
  }

  navigateAndClose(route: string): void {
    this.close();
    this.router.navigateByUrl(route);
  }

  close(): void {
    this.modalClose.emit();
  }
}
