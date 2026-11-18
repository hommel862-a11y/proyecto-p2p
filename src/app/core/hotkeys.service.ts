import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceRepricerService } from './binance-repricer.service';

export const HOTKEY_ACTIONS = {
  SYNC: 'SYNC',
  FETCH_MARKET: 'FETCH_MARKET',
  TOGGLE_BOT: 'TOGGLE_BOT',
  KILL_SWITCH: 'KILL_SWITCH',
  CHEAT_SHEET: 'CHEAT_SHEET',
  TOGGLE_CLEAN_MODE: 'TOGGLE_CLEAN_MODE',
  APPLY_MAKER_OPTIMAL: 'APPLY_MAKER_OPTIMAL',
  APPLY_TAKER_VWAP: 'APPLY_TAKER_VWAP',
  BRACKET_1: 'BRACKET_1',
  BRACKET_2: 'BRACKET_2',
  BRACKET_3: 'BRACKET_3',
} as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[keyof typeof HOTKEY_ACTIONS];

export const HOTKEY_CATEGORIES = {
  OPERACIONES: 'OPERACIONES',
  BOT: 'BOT',
  SISTEMA: 'SISTEMA',
  MICROESTRUCTURA: 'MICROESTRUCTURA',
} as const;

export type HotkeyCategory = (typeof HOTKEY_CATEGORIES)[keyof typeof HOTKEY_CATEGORIES];

export interface HotkeyDefinition {
  key: string;
  description: string;
  category: HotkeyCategory;
  action: HotkeyAction;
}

export const HOTKEYS_CATALOG: HotkeyDefinition[] = [
  {
    key: 'F1',
    description: 'Sincronizar y refrescar libro de órdenes / spreads',
    category: 'OPERACIONES',
    action: 'SYNC',
  },
  {
    key: 'F2',
    description: 'Cargar precios de mercado de Binance P2P',
    category: 'OPERACIONES',
    action: 'FETCH_MARKET',
  },
  {
    key: 'F5',
    description: 'Iniciar / Pausar Bot de Repricing',
    category: 'BOT',
    action: 'TOGGLE_BOT',
  },
  {
    key: 'Esc',
    description: 'KILL-SWITCH: Apagar bot de emergencia y cerrar modales',
    category: 'BOT',
    action: 'KILL_SWITCH',
  },
  {
    key: '?',
    description: 'Abrir / Cerrar atajos de teclado rápidos',
    category: 'SISTEMA',
    action: 'CHEAT_SHEET',
  },
  {
    key: 'L',
    description: 'Alternar Clean Mode (filtro anti-spoof y liquidez fantasma)',
    category: 'MICROESTRUCTURA',
    action: 'TOGGLE_CLEAN_MODE',
  },
  {
    key: 'M',
    description: 'Aplicar precio óptimo Maker desde Microestructura',
    category: 'MICROESTRUCTURA',
    action: 'APPLY_MAKER_OPTIMAL',
  },
  {
    key: 'T',
    description: 'Aplicar VWAP Taker ejecutable desde Microestructura',
    category: 'MICROESTRUCTURA',
    action: 'APPLY_TAKER_VWAP',
  },
  {
    key: '1',
    description: 'Seleccionar Tramo 1 de capital (Inframundo)',
    category: 'MICROESTRUCTURA',
    action: 'BRACKET_1',
  },
  {
    key: '2',
    description: 'Seleccionar Tramo 2 de capital (Medio)',
    category: 'MICROESTRUCTURA',
    action: 'BRACKET_2',
  },
  {
    key: '3',
    description: 'Seleccionar Tramo 3 de capital (Institucional)',
    category: 'MICROESTRUCTURA',
    action: 'BRACKET_3',
  },
];

const MICROSTRUCTURE_KEY_ACTIONS: Readonly<Record<string, HotkeyAction>> = {
  l: HOTKEY_ACTIONS.TOGGLE_CLEAN_MODE,
  m: HOTKEY_ACTIONS.APPLY_MAKER_OPTIMAL,
  t: HOTKEY_ACTIONS.APPLY_TAKER_VWAP,
  '1': HOTKEY_ACTIONS.BRACKET_1,
  '2': HOTKEY_ACTIONS.BRACKET_2,
  '3': HOTKEY_ACTIONS.BRACKET_3,
};

@Injectable({ providedIn: 'root' })
export class HotkeysService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly repricer = inject(BinanceRepricerService);

  readonly isCheatSheetOpen = signal<boolean>(false);
  readonly isPaletteOpen = signal<boolean>(false);
  private readonly listeners = new Map<HotkeyAction, Set<() => void>>();
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.initGlobalListener();
  }

  ngOnDestroy(): void {
    if (this.keydownHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  register(action: HotkeyAction, callback: () => void): () => void {
    if (!this.listeners.has(action)) {
      this.listeners.set(action, new Set());
    }
    this.listeners.get(action)!.add(callback);

    return () => {
      this.listeners.get(action)?.delete(callback);
    };
  }

  trigger(action: HotkeyAction): void {
    const callbacks = this.listeners.get(action);
    if (callbacks && callbacks.size > 0) {
      for (const cb of callbacks) {
        try {
          cb();
        } catch (err) {
          console.error(`[HotkeysService] Error executing ${action} handler:`, err);
        }
      }
    }
  }

  openModal(): void {
    this.isCheatSheetOpen.set(true);
  }

  closeModal(): void {
    this.isCheatSheetOpen.set(false);
  }

  toggleModal(): void {
    this.isCheatSheetOpen.update((v) => !v);
  }

  openPalette(): void {
    this.isPaletteOpen.set(true);
  }

  closePalette(): void {
    this.isPaletteOpen.set(false);
  }

  togglePalette(): void {
    this.isPaletteOpen.update((v) => !v);
  }

  private initGlobalListener(): void {
    if (typeof window === 'undefined') return;

    this.keydownHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Ctrl+K / Cmd+K opens palette
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        this.togglePalette();
        return;
      }

      // ESC always closes palette, then modal, then kills bot — even inside inputs
      if (event.key === 'Escape') {
        if (this.isPaletteOpen()) {
          this.closePalette();
          event.preventDefault();
          return;
        }

        if (this.isCheatSheetOpen()) {
          this.closeModal();
          event.preventDefault();
          return;
        }

        if (this.repricer.isActive()) {
          this.repricer.killSwitch();
          event.preventDefault();
          return;
        }

        this.trigger('KILL_SWITCH');
        return;
      }

      // If user is typing in form fields, ignore function keys and shortcut letters
      if (isInput) return;

      if (event.key === 'F1') {
        event.preventDefault();
        this.trigger('SYNC');
        this.toast.info('Sincronización manual solicitada (F1).', 'Atajo de Teclado');
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        this.trigger('FETCH_MARKET');
        this.toast.info('Carga de precios P2P solicitada (F2).', 'Atajo de Teclado');
        return;
      }

      if (event.key === 'F5' || (event.altKey && (event.key === 'r' || event.key === 'R'))) {
        event.preventDefault();
        this.repricer.toggle();
        this.trigger('TOGGLE_BOT');
        return;
      }

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        this.toggleModal();
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const mappedAction = MICROSTRUCTURE_KEY_ACTIONS[event.key.toLowerCase()];
        if (mappedAction) {
          event.preventDefault();
          this.trigger(mappedAction);
        }
      }
    };

    window.addEventListener('keydown', this.keydownHandler);
  }
}
