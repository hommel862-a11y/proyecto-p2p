import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotkeysService, HOTKEYS_CATALOG } from '../../core/hotkeys.service';

@Component({
  selector: 'app-hotkeys-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (hotkeys.isCheatSheetOpen()) {
      <div
        class="hotkeys-backdrop"
        role="button"
        tabindex="0"
        (click)="$event.target === $event.currentTarget && close()"
        (keydown.escape)="close()"
        aria-label="Cerrar modal de atajos"
      >
        <div
          class="hotkeys-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hotkeys-dialog-heading"
          tabindex="-1"
        >
          <div class="dialog-header">
            <div class="header-title">
              <span class="icon" aria-hidden="true">⌨️</span>
              <div>
                <h3 id="hotkeys-dialog-heading">Atajos Rápidos de Terminal</h3>
                <p>Comandos de teclado para operaciones institucionales de alta velocidad</p>
              </div>
            </div>
            <button class="btn-close" (click)="close()" aria-label="Cerrar modal de atajos">
              &times;
            </button>
          </div>

          <div class="dialog-body">
            <div class="hotkeys-grid">
              @for (item of catalog; track item.key) {
                <div class="hotkey-card" [class.emergency]="item.action === 'KILL_SWITCH'">
                  <div class="key-badge">
                    <kbd>{{ item.key }}</kbd>
                  </div>
                  <div class="key-info">
                    <span class="category-tag">{{ item.category }}</span>
                    <span class="desc">{{ item.description }}</span>
                  </div>
                </div>
              }
            </div>

            <div class="kill-switch-notice">
              <span class="pulse-dot"></span>
              <span
                ><strong>REGLA CRÍTICA:</strong> La tecla <kbd>Esc</kbd> detiene de inmediato
                cualquier ciclo del bot de repricing sin confirmación previa.</span
              >
            </div>
          </div>

          <div class="dialog-footer">
            <button type="button" class="btn-primary" (click)="close()">Entendido (Esc)</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .hotkeys-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(4, 9, 20, 0.78);
        backdrop-filter: blur(5px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        animation: fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .hotkeys-dialog {
        background: #0d1527;
        border: 1px solid rgba(216, 180, 92, 0.35);
        border-radius: 12px;
        width: 100%;
        max-width: 580px;
        box-shadow:
          0 24px 48px rgba(0, 0, 0, 0.6),
          0 0 20px rgba(216, 180, 92, 0.12);
        color: #f1f5f9;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);

        .header-title {
          display: flex;
          gap: 0.85rem;
          align-items: center;

          .icon {
            font-size: 1.6rem;
          }

          h3 {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
            color: #f5e6bd;
            letter-spacing: -0.01em;
          }

          p {
            margin: 0.15rem 0 0;
            font-size: 0.78rem;
            color: #94a3b8;
          }
        }

        .btn-close {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 1.7rem;
          cursor: pointer;
          line-height: 1;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          transition: color 0.15s;

          &:hover {
            color: #fff;
          }
        }
      }

      .dialog-body {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .hotkeys-grid {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }

      .hotkey-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 0.65rem 1rem;
        border-radius: 8px;
        transition: all 0.15s ease;

        &:hover {
          background: rgba(216, 180, 92, 0.06);
          border-color: rgba(216, 180, 92, 0.25);
        }

        &.emergency {
          border-color: rgba(239, 68, 68, 0.35);
          background: rgba(239, 68, 68, 0.05);

          kbd {
            border-color: rgba(239, 68, 68, 0.5);
            color: #fca5a5;
          }

          .category-tag {
            color: #ef4444;
            background: rgba(239, 68, 68, 0.15);
          }
        }

        .key-badge {
          min-width: 54px;
          display: flex;
          justify-content: center;
        }

        kbd {
          background: #1e293b;
          color: #f5e6bd;
          border: 1px solid rgba(216, 180, 92, 0.35);
          padding: 0.25rem 0.6rem;
          border-radius: 5px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.85rem;
          font-weight: 700;
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.4);
        }

        .key-info {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          flex: 1;

          .category-tag {
            font-size: 0.65rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #d8b45c;
            align-self: flex-start;
          }

          .desc {
            font-size: 0.86rem;
            color: #cbd5e1;
          }
        }
      }

      .kill-switch-notice {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.25);
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-size: 0.82rem;
        color: #fca5a5;

        .pulse-dot {
          width: 8px;
          height: 8px;
          background: #ef4444;
          border-radius: 50%;
          box-shadow: 0 0 8px #ef4444;
          flex-shrink: 0;
        }

        kbd {
          background: #1e293b;
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.4);
          padding: 0.1rem 0.35rem;
          border-radius: 4px;
          font-size: 0.8rem;
        }
      }

      .dialog-footer {
        padding: 1rem 1.5rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.015);
        display: flex;
        justify-content: flex-end;

        .btn-primary {
          background: linear-gradient(135deg, #d8b45c, #b08a33);
          color: #0b1329;
          font-weight: 600;
          border: none;
          padding: 0.5rem 1.25rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.88rem;
          transition: opacity 0.15s;

          &:hover {
            opacity: 0.92;
          }
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: scale(0.98);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    `,
  ],
})
export class HotkeysModalComponent {
  protected readonly hotkeys = inject(HotkeysService);
  protected readonly catalog = HOTKEYS_CATALOG;

  close(): void {
    this.hotkeys.closeModal();
  }
}
