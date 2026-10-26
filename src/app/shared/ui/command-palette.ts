import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { HotkeysService } from '../../core/hotkeys.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';

export interface PaletteCommand {
  id: string;
  label: string;
  icon: string;
  hint?: string;
  group: string;
  action: () => void | Promise<void>;
}

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hotkeys.isPaletteOpen()) {
      <div
        class="palette-backdrop"
        (click)="$event.target === $event.currentTarget && close()"
        (keydown.escape)="close()"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
      >
        <div class="palette-panel">
          <div class="palette-input-wrap">
            <svg
              class="palette-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              #searchInput
              type="text"
              class="palette-input"
              placeholder="Buscar comando o vista..."
              [value]="query()"
              (input)="onInput($event)"
              (keydown.arrowDown)="onArrowDown($event)"
              (keydown.arrowUp)="onArrowUp($event)"
              (keydown.enter)="onEnter($event)"
              (keydown.escape)="close()"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="palette-shortcut-hint">Esc</span>
          </div>

          @if (filteredGroups().length === 0) {
            <div class="palette-empty">Sin resultados</div>
          } @else {
            <div class="palette-list">
              @for (group of filteredGroups(); track group.name) {
                <div class="palette-group-label">{{ group.name }}</div>
                @for (cmd of group.commands; track cmd.id) {
                  <button
                    type="button"
                    class="palette-item"
                    [class.active]="selectedIndex() === cmd._idx"
                    (click)="execute(cmd)"
                    (mouseenter)="selectedIndex.set(cmd._idx)"
                  >
                    <span class="palette-item-icon">
                      @switch (cmd.icon) {
                        @case ('dashboard') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <rect x="3" y="3" width="7" height="7" />
                            <rect x="14" y="3" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" />
                            <rect x="14" y="14" width="7" height="7" />
                          </svg>
                        }
                        @case ('spread') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="3 12 7 12 10 20 14 4 17 12 21 12" />
                          </svg>
                        }
                        @case ('income') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <rect x="5" y="3" width="14" height="18" rx="2" />
                            <line x1="8" y1="7" x2="16" y2="7" />
                            <line x1="8" y1="11" x2="16" y2="11" />
                            <line x1="8" y1="15" x2="16" y2="15" />
                          </svg>
                        }
                        @case ('log') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <line x1="8" y1="6" x2="20" y2="6" />
                            <line x1="8" y1="12" x2="20" y2="12" />
                            <line x1="8" y1="18" x2="20" y2="18" />
                            <circle cx="4" cy="6" r="1" />
                            <circle cx="4" cy="12" r="1" />
                            <circle cx="4" cy="18" r="1" />
                          </svg>
                        }
                        @case ('risk') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
                          </svg>
                        }
                        @case ('stats') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <line x1="4" y1="20" x2="20" y2="20" />
                            <rect x="5" y="11" width="3" height="7" />
                            <rect x="10.5" y="6" width="3" height="12" />
                            <rect x="16" y="13" width="3" height="5" />
                          </svg>
                        }
                        @case ('guide') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path
                              d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
                            />
                            <polyline points="15 4 15 9 20 9" />
                            <line x1="8" y1="13" x2="13" y2="13" />
                            <line x1="8" y1="17" x2="13" y2="17" />
                          </svg>
                        }
                        @case ('theme') {
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                          </svg>
                        }
                        @case ('hotkeys') {
                          <span class="palette-icon-emoji">⌨️</span>
                        }
                        @default {
                          <span class="palette-icon-emoji">{{ cmd.icon }}</span>
                        }
                      }
                    </span>
                    <span class="palette-item-label">{{ cmd.label }}</span>
                    @if (cmd.hint) {
                      <span class="palette-item-hint">{{ cmd.hint }}</span>
                    }
                  </button>
                }
              }
            </div>
          }

          <div class="palette-footer">
            <span class="palette-footer-item"><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
            <span class="palette-footer-item"><kbd>↵</kbd> Ejecutar</span>
            <span class="palette-footer-item"><kbd>Esc</kbd> Cerrar</span>
            <span class="palette-footer-brand">P2P QUANTUM HUD</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .palette-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 7, 14, 0.78);
      backdrop-filter: blur(12px) saturate(140%);
      -webkit-backdrop-filter: blur(12px) saturate(140%);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: min(16vh, 140px);
      z-index: 1100;
      animation: paletteFadeIn 0.15s var(--ease-out);
    }

    .palette-panel {
      background: linear-gradient(165deg, color-mix(in srgb, var(--panel-2) 95%, rgba(255, 255, 255, 0.05)) 0%, var(--panel) 100%);
      border: 1px solid var(--line-strong);
      border-top: 1px solid color-mix(in srgb, var(--gold) 45%, var(--line-strong));
      border-radius: 18px;
      width: 100%;
      max-width: 580px;
      box-shadow:
        0 28px 70px -12px rgba(0, 0, 0, 0.8),
        0 0 42px rgba(216, 180, 92, 0.14),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
      overflow: hidden;
      animation: paletteSlideIn 0.18s var(--ease-out);
    }

    .palette-input-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line-strong);
      background: rgba(255, 255, 255, 0.015);
    }

    .palette-search-icon {
      width: 19px;
      height: 19px;
      color: var(--gold);
      flex-shrink: 0;
    }

    .palette-input {
      flex: 1;
      background: transparent !important;
      border: none !important;
      outline: none !important;
      color: var(--text);
      font-family: var(--font-body);
      font-size: 0.98rem;
      font-weight: 500;
      padding: 0;
      box-shadow: none !important;
    }
    .palette-input::placeholder {
      color: var(--muted);
      opacity: 0.65;
    }

    .palette-shortcut-hint {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--muted);
      background: var(--panel-2);
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      padding: 3px 8px;
      letter-spacing: 0.03em;
    }

    .palette-list {
      max-height: 360px;
      overflow-y: auto;
      padding: 8px;
    }

    .palette-group-label {
      font-family: var(--font-display);
      font-size: 0.64rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--gold);
      padding: 10px 12px 6px;
      user-select: none;
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--text);
      font-family: var(--font-body);
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      box-shadow: none;
      transition:
        background 0.12s var(--ease-out),
        border-color 0.12s var(--ease-out),
        transform 0.12s var(--ease-out);
    }

    .palette-item:hover,
    .palette-item.active {
      background: linear-gradient(90deg, rgba(216, 180, 92, 0.14) 0%, rgba(216, 180, 92, 0.04) 100%);
      border-color: rgba(216, 180, 92, 0.32);
      box-shadow: inset 3px 0 0 var(--gold);
      transform: none;
    }

    .palette-item-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: rgba(216, 180, 92, 0.1);
      border: 1px solid rgba(216, 180, 92, 0.22);
      color: var(--gold);
      flex-shrink: 0;
    }
    .palette-item-icon svg {
      width: 15px;
      height: 15px;
    }
    .palette-icon-emoji {
      font-size: 14px;
      line-height: 1;
    }

    .palette-item-label {
      flex: 1;
      min-width: 0;
      font-weight: 600;
    }

    .palette-item-hint {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--muted);
      background: var(--bg-1);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 2px 8px;
      flex-shrink: 0;
    }

    .palette-empty {
      padding: 28px 18px;
      text-align: center;
      color: var(--muted);
      font-size: 0.88rem;
    }

    .palette-footer {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 18px;
      border-top: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg-0) 65%, var(--panel));
      font-size: 0.72rem;
      color: var(--muted);
    }

    .palette-footer-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      kbd {
        font-family: var(--font-mono);
        font-size: 0.66rem;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--panel-2);
        border: 1px solid var(--line-strong);
        color: var(--text);
      }
    }

    .palette-footer-brand {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--gold);
    }

    @keyframes paletteFadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes paletteSlideIn {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  protected readonly hotkeys = inject(HotkeysService);
  private readonly accountsService = inject(AccountsService);
  private readonly toast = inject(ToastService);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly query = signal('');
  protected readonly selectedIndex = signal(0);

  protected readonly allCommands = computed(() => this.buildCommands());

  private readonly flatFiltered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const all = this.allCommands();
    const list = !q
      ? all.slice()
      : all.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            (c.hint ?? '').toLowerCase().includes(q) ||
            c.group.toLowerCase().includes(q),
        );
    return list.map((c, i) => ({ ...c, _idx: i }));
  });

  protected readonly filteredGroups = computed(() => {
    const groups = new Map<string, ({ _idx: number } & PaletteCommand)[]>();
    for (const item of this.flatFiltered()) {
      const key = item.group as string;
      const g = groups.get(key) ?? [];
      g.push(item as { _idx: number } & PaletteCommand);
      groups.set(key, g);
    }
    return Array.from(groups.entries()).map(([name, commands]) => ({ name, commands }));
  });

  private focusEffect = effect(() => {
    if (this.hotkeys.isPaletteOpen()) {
      this.query.set('');
      this.selectedIndex.set(0);
      queueMicrotask(() => {
        try {
          this.searchInput().nativeElement.focus();
        } catch {
          /* noop */
        }
      });
    }
  });

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.query.set(val);
    this.selectedIndex.set(0);
  }

  onArrowDown(event: Event): void {
    event.preventDefault();
    const max = this.flatFiltered().length - 1;
    this.selectedIndex.update((i) => (i >= max ? 0 : i + 1));
    this.scrollToActive();
  }

  onArrowUp(event: Event): void {
    event.preventDefault();
    const max = this.flatFiltered().length - 1;
    this.selectedIndex.update((i) => (i <= 0 ? max : i - 1));
    this.scrollToActive();
  }

  onEnter(event: Event): void {
    event.preventDefault();
    const items = this.flatFiltered();
    const cmd = items[this.selectedIndex()];
    if (cmd) this.execute(cmd as PaletteCommand);
  }

  execute(cmd: PaletteCommand): void {
    this.close();
    queueMicrotask(() => {
      void cmd.action();
    });
  }

  close(): void {
    this.hotkeys.closePalette();
  }

  private scrollToActive(): void {
    queueMicrotask(() => {
      try {
        document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
      } catch {
        /* noop */
      }
    });
  }

  private buildCommands(): PaletteCommand[] {
    const groupsOrder = ['TESORERÍA & BANCOS', 'MISIÓN', 'PLANIFICACIÓN', 'IA & AUTOMATIZACIÓN', 'CONFIG', 'ACCIONES'];

    const bankCommands: PaletteCommand[] = this.accountsService.accounts().map((acc) => ({
      id: `inject-${acc.id}`,
      label: `Inyectar liquidez en ${acc.bankName}`,
      icon: '💧',
      hint: acc.rail === 'TRANSFERENCIA' ? 'Transf' : 'Pago Móvil',
      group: 'TESORERÍA & BANCOS',
      action: () => {
        this.accountsService.requestLiquidityModal(acc.id);
        void this.router.navigate(['/dashboard'], { queryParams: { tab: 'treasury' } });
      },
    }));

    const commands: PaletteCommand[] = [
      {
        id: 'action-inject-liquidity',
        label: 'Inyectar Liquidez Bancaria...',
        icon: '💧',
        hint: 'Fondeo rápido',
        group: 'TESORERÍA & BANCOS',
        action: () => {
          this.accountsService.requestLiquidityModal();
          void this.router.navigate(['/dashboard'], { queryParams: { tab: 'treasury' } });
        },
      },
      {
        id: 'action-sync-official-banks',
        label: 'Sincronizar 8 Bancos Oficiales en SQLite',
        icon: '🔄',
        hint: 'SQLite',
        group: 'TESORERÍA & BANCOS',
        action: async () => {
          await this.accountsService.restoreDefaultAccounts();
          this.toast.info(
            'Catálogo de los 8 bancos oficiales sincronizado y asegurado en SQLite.',
            'Bancos Sincronizados',
          );
        },
      },
      {
        id: 'nav-treasury-tab',
        label: 'Ver Tesorería & Rotación Anti-SUDEBAN',
        icon: '🏛️',
        hint: '/dashboard?tab=treasury',
        group: 'TESORERÍA & BANCOS',
        action: () => void this.router.navigate(['/dashboard'], { queryParams: { tab: 'treasury' } }),
      },
      ...bankCommands,
      {
        id: 'nav-dashboard',
        label: 'Centro de Control',
        icon: 'dashboard',
        hint: '/dashboard',
        group: 'MISIÓN',
        action: () => void this.router.navigate(['/dashboard']),
      },
      {
        id: 'nav-agents-tab',
        label: 'Ver Enjambre de Agentes & Riesgo',
        icon: '🤖',
        hint: '/dashboard?tab=agents',
        group: 'MISIÓN',
        action: () => void this.router.navigate(['/dashboard'], { queryParams: { tab: 'agents' } }),
      },
      {
        id: 'nav-spread',
        label: 'Monitor de Spread',
        icon: 'spread',
        hint: '/spread',
        group: 'MISIÓN',
        action: () => void this.router.navigate(['/spread']),
      },
      {
        id: 'nav-radar',
        label: 'Radar P2P & Cazador de Liquidez',
        icon: '📡',
        hint: '/radar',
        group: 'MISIÓN',
        action: () => void this.router.navigate(['/radar']),
      },
      {
        id: 'nav-log',
        label: 'Registro de Operaciones (Bitácora)',
        icon: 'log',
        hint: '/log',
        group: 'MISIÓN',
        action: () => void this.router.navigate(['/log']),
      },
      {
        id: 'nav-income',
        label: 'Calculadora de Ingresos',
        icon: 'income',
        hint: '/income',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/income']),
      },
      {
        id: 'nav-growth-projector',
        label: 'Proyector de Crecimiento Compuesto (90D)',
        icon: 'income',
        hint: '/growth-projector',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/growth-projector']),
      },
      {
        id: 'nav-triangulation',
        label: 'Triangulación Multidivisa',
        icon: 'income',
        hint: '/triangulation',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/triangulation']),
      },
      {
        id: 'nav-remittances',
        label: 'Envíos y Remesas Multi-Ruta',
        icon: '💸',
        hint: '/remittances',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/remittances']),
      },
      {
        id: 'nav-finance-360',
        label: 'Finanzas 360° & Patrimonio',
        icon: '🏦',
        hint: '/finanzas-360',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/finanzas-360']),
      },
      {
        id: 'nav-scanner',
        label: 'Escáner OCR de Comprobantes',
        icon: '🔍',
        hint: '/receipts',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/receipts']),
      },
      {
        id: 'nav-stats',
        label: 'Estadísticas / Cumplimiento',
        icon: 'stats',
        hint: '/stats',
        group: 'PLANIFICACIÓN',
        action: () => void this.router.navigate(['/stats']),
      },
      {
        id: 'nav-copilot',
        label: 'Copiloto IA Cuántico',
        icon: '🧠',
        hint: '/copilot',
        group: 'IA & AUTOMATIZACIÓN',
        action: () => void this.router.navigate(['/copilot']),
      },
      {
        id: 'nav-agent-studio',
        label: 'Estudio de Agentes & Swarms',
        icon: '⚙️',
        hint: '/agents',
        group: 'IA & AUTOMATIZACIÓN',
        action: () => void this.router.navigate(['/agents']),
      },
      {
        id: 'nav-mcp-hub',
        label: 'Centro MCP (45 Herramientas)',
        icon: '🔌',
        hint: '/mcp',
        group: 'IA & AUTOMATIZACIÓN',
        action: () => void this.router.navigate(['/mcp']),
      },
      {
        id: 'nav-risk',
        label: 'Reglas de Riesgo',
        icon: 'risk',
        hint: '/risk',
        group: 'CONFIG',
        action: () => void this.router.navigate(['/risk']),
      },
      {
        id: 'nav-guide',
        label: 'Guía de uso',
        icon: 'guide',
        hint: '/guide',
        group: 'CONFIG',
        action: () => void this.router.navigate(['/guide']),
      },
      {
        id: 'action-killswitch',
        label: 'KILL-SWITCH: Apagado Inmediato de Emergencia',
        icon: '🚨',
        hint: 'Escape / Pánico',
        group: 'ACCIONES',
        action: () => this.hotkeys.trigger('KILL_SWITCH'),
      },
      {
        id: 'action-theme',
        label: 'Cambiar tema (claro / oscuro)',
        icon: 'theme',
        group: 'ACCIONES',
        action: () => {
          const ev = new CustomEvent('palette-toggle-theme');
          window.dispatchEvent(ev);
        },
      },
      {
        id: 'action-hotkeys',
        label: 'Ver atajos de teclado',
        icon: 'hotkeys',
        hint: '?',
        group: 'ACCIONES',
        action: () => this.hotkeys.openModal(),
      },
    ];

    return commands.sort((a, b) => groupsOrder.indexOf(a.group) - groupsOrder.indexOf(b.group));
  }
}
