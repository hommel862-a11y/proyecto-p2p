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

type IconId =
  'dashboard' | 'spread' | 'income' | 'log' | 'risk' | 'stats' | 'guide' | 'theme' | 'hotkeys';

export interface PaletteCommand {
  id: string;
  label: string;
  icon: IconId | '⌨️';
  hint?: string;
  group: string;
  action: () => void;
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
      background: rgba(5, 8, 15, 0.82);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: min(20vh, 180px);
      z-index: 1100;
      animation: paletteFadeIn 0.15s var(--ease-out);
    }

    .palette-panel {
      background: var(--panel);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 520px;
      box-shadow:
        var(--shadow-lg),
        0 0 40px rgba(216, 180, 92, 0.1);
      overflow: hidden;
      animation: paletteSlideIn 0.18s var(--ease-out);
    }

    .palette-input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }

    .palette-search-icon {
      width: 18px;
      height: 18px;
      color: var(--muted);
      flex-shrink: 0;
    }

    .palette-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text);
      font-family: var(--font-body);
      font-size: 0.95rem;
      padding: 0;
      box-shadow: none;
    }
    .palette-input::placeholder {
      color: var(--muted);
      opacity: 0.6;
    }

    .palette-shortcut-hint {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--muted);
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 2px 6px;
      letter-spacing: 0.02em;
    }

    .palette-list {
      max-height: 340px;
      overflow-y: auto;
      padding: 6px;
    }

    .palette-group-label {
      font-family: var(--font-display);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      padding: 10px 12px 5px;
      user-select: none;
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text);
      font-family: var(--font-body);
      font-size: 0.88rem;
      cursor: pointer;
      text-align: left;
      transition:
        background 0.12s var(--ease-out),
        border-color 0.12s var(--ease-out);
    }

    .palette-item:hover,
    .palette-item.active {
      background: rgba(216, 180, 92, 0.08);
      border-color: rgba(216, 180, 92, 0.18);
    }
    .palette-item.active {
      background: rgba(216, 180, 92, 0.12);
      border-color: rgba(216, 180, 92, 0.3);
    }

    .palette-item-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      color: var(--gold);
      flex-shrink: 0;
    }
    .palette-item-icon svg {
      width: 18px;
      height: 18px;
    }
    .palette-icon-emoji {
      font-size: 18px;
      line-height: 1;
    }

    .palette-item-label {
      flex: 1;
      min-width: 0;
    }

    .palette-item-hint {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--muted);
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 2px 7px;
      flex-shrink: 0;
    }

    .palette-empty {
      padding: 24px 18px;
      text-align: center;
      color: var(--muted);
      font-size: 0.88rem;
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
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly query = signal('');
  protected readonly selectedIndex = signal(0);

  private readonly allCommands = this.buildCommands();

  private readonly flatFiltered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const list = !q
      ? this.allCommands.slice()
      : this.allCommands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            (c.hint ?? '').toLowerCase().includes(q),
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
    queueMicrotask(() => cmd.action());
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
    const groupsOrder = ['MISIÓN', 'PLANIFICACIÓN', 'CONFIG', 'ACCIONES'];

    const commands: PaletteCommand[] = [
      {
        id: 'nav-dashboard',
        label: 'Centro de Control',
        icon: 'dashboard',
        hint: '/dashboard',
        group: 'MISIÓN',
        action: () => this.router.navigate(['/dashboard']),
      },
      {
        id: 'nav-spread',
        label: 'Monitor de Spread',
        icon: 'spread',
        hint: '/spread',
        group: 'MISIÓN',
        action: () => this.router.navigate(['/spread']),
      },
      {
        id: 'nav-log',
        label: 'Registro de Operaciones',
        icon: 'log',
        hint: '/log',
        group: 'MISIÓN',
        action: () => this.router.navigate(['/log']),
      },
      {
        id: 'nav-income',
        label: 'Calculadora de Ingresos',
        icon: 'income',
        hint: '/income',
        group: 'PLANIFICACIÓN',
        action: () => this.router.navigate(['/income']),
      },
      {
        id: 'nav-triangulation',
        label: 'Triangulación Multidivisa',
        icon: 'income',
        hint: '/triangulation',
        group: 'PLANIFICACIÓN',
        action: () => this.router.navigate(['/triangulation']),
      },
      {
        id: 'nav-stats',
        label: 'Estadísticas / Cumplimiento',
        icon: 'stats',
        hint: '/stats',
        group: 'PLANIFICACIÓN',
        action: () => this.router.navigate(['/stats']),
      },
      {
        id: 'nav-risk',
        label: 'Reglas de Riesgo',
        icon: 'risk',
        hint: '/risk',
        group: 'CONFIG',
        action: () => this.router.navigate(['/risk']),
      },
      {
        id: 'nav-guide',
        label: 'Guía de uso',
        icon: 'guide',
        hint: '/guide',
        group: 'CONFIG',
        action: () => this.router.navigate(['/guide']),
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
