import { Component, signal, computed, inject, DestroyRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastComponent } from './core/toast.component';
import { HotkeysModalComponent } from './shared/components/hotkeys-modal.component';
import { CommandPalette } from './shared/ui/command-palette';
import { HotkeysService } from './core/hotkeys.service';
import { ClipboardPaymentBannerComponent } from './shared/components/clipboard-payment-banner.component';
import { ApiSettingsModalComponent } from './shared/components/api-settings-modal.component';
import { ProductTourModalComponent } from './shared/components/product-tour-modal.component';
import { CotizaveService } from './core/cotizave.service';
import { BinanceP2pService } from './core/binance-p2p.service';
import { TelegramWorkerService } from './core/telegram-worker.service';

export type AppTheme = 'dark' | 'apple-dark' | 'light';

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    HotkeysModalComponent,
    CommandPalette,
    ClipboardPaymentBannerComponent,
    ApiSettingsModalComponent,
    ProductTourModalComponent,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('p2p');
  readonly cotizave = inject(CotizaveService);
  readonly binance = inject(BinanceP2pService);
  readonly telegram = inject(TelegramWorkerService);
  readonly mobileDrawerOpen = signal<boolean>(false);
  readonly sidebarCollapsed = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem('p2p.sidebar_collapsed') === 'true',
  );
  readonly apiModalOpen = signal<boolean>(false);
  readonly tourModalOpen = signal<boolean>(false);

  readonly hasActiveApis = computed<boolean>(() => {
    return !!this.cotizave.apiKey();
  });
  readonly theme = signal<AppTheme>(this.initialTheme());
  readonly themeLabel = computed<string>(() => {
    switch (this.theme()) {
      case 'apple-dark':
        return 'Apple Pro';
      case 'light':
        return 'Modo claro';
      case 'dark':
      default:
        return 'Modo oscuro';
    }
  });
  /** Real app version when running under Electron; falls back to the web build. */
  readonly version = signal<string>('1.4.1');
  readonly hotkeys = inject(HotkeysService);
  readonly isInputFocused = signal<boolean>(false);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    try {
      document.documentElement.setAttribute('data-theme', this.theme());
    } catch {
      /* sin DOM */
    }
    this.resolveVersion();
    this.listenThemeToggle();
    this.listenInputFocus();
  }

  private listenInputFocus(): void {
    if (typeof window === 'undefined') return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        this.isInputFocused.set(true);
      }
    };
    const onFocusOut = () => {
      this.isInputFocused.set(false);
    };
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    });
  }

  private resolveVersion(): void {
    const bridge = (globalThis as { electron?: { getVersion?: () => Promise<string> } }).electron;
    if (bridge?.getVersion) {
      bridge
        .getVersion()
        .then((v) => this.version.set(v))
        .catch(() => {
          /* mantén el fallback */
        });
      return;
    }
    try {
      const webVersion = localStorage.getItem('p2p.version') ?? '1.4.1';
      this.version.set(webVersion);
    } catch {
      /* sin almacenamiento */
    }
  }

  private initialTheme(): AppTheme {
    try {
      const stored = localStorage.getItem('p2p.theme');
      if (stored === 'apple-dark' || stored === 'light' || stored === 'dark') {
        return stored;
      }
      return 'dark';
    } catch {
      return 'dark';
    }
  }

  toggleTheme(): void {
    const current = this.theme();
    const next: AppTheme =
      current === 'dark' ? 'apple-dark' : current === 'apple-dark' ? 'light' : 'dark';
    this.theme.set(next);
    try {
      localStorage.setItem('p2p.theme', next);
      document.documentElement.setAttribute('data-theme', next);
    } catch {
      try {
        document.documentElement.setAttribute('data-theme', next);
      } catch {
        /* sin DOM */
      }
    }
  }

  toggleMobileDrawer(): void {
    this.mobileDrawerOpen.update((v) => !v);
  }

  closeMobileDrawer(): void {
    this.mobileDrawerOpen.set(false);
  }

  openApiModal(): void {
    this.apiModalOpen.set(true);
    this.mobileDrawerOpen.set(false);
  }

  closeApiModal(): void {
    this.apiModalOpen.set(false);
  }

  openTourModal(): void {
    this.tourModalOpen.set(true);
    this.mobileDrawerOpen.set(false);
  }

  closeTourModal(): void {
    this.tourModalOpen.set(false);
  }

  private listenThemeToggle(): void {
    const handler = () => this.toggleTheme();
    window.addEventListener('palette-toggle-theme', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('palette-toggle-theme', handler));
  }
}
