import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceRepricerService } from './binance-repricer.service';

export type HotkeyAction = 'SYNC' | 'FETCH_MARKET' | 'TOGGLE_BOT' | 'KILL_SWITCH' | 'CHEAT_SHEET';

export interface HotkeyDefinition {
  key: string;
  description: string;
  category: 'OPERACIONES' | 'BOT' | 'SISTEMA';
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
];

@Injectable({ providedIn: 'root' })
export class HotkeysService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly repricer = inject(BinanceRepricerService);

  readonly isCheatSheetOpen = signal<boolean>(false);
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

      // ESC always triggers kill switch & closes modal, even inside inputs
      if (event.key === 'Escape') {
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
    };

    window.addEventListener('keydown', this.keydownHandler);
  }
}
