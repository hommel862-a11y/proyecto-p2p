import { Component, signal, computed, inject, DestroyRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastComponent } from './core/toast.component';
import { HotkeysModalComponent } from './shared/components/hotkeys-modal.component';
import { CommandPalette } from './shared/ui/command-palette';
import { HotkeysService } from './core/hotkeys.service';
import { ClipboardPaymentBannerComponent } from './shared/components/clipboard-payment-banner.component';

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
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('p2p');
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
  readonly version = signal<string>('1.0.0');
  readonly hotkeys = inject(HotkeysService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    try {
      document.documentElement.setAttribute('data-theme', this.theme());
    } catch {
      /* sin DOM */
    }
    this.resolveVersion();
    this.listenThemeToggle();
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
      const webVersion = localStorage.getItem('p2p.version') ?? '1.0.0';
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

  private listenThemeToggle(): void {
    const handler = () => this.toggleTheme();
    window.addEventListener('palette-toggle-theme', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('palette-toggle-theme', handler));
  }
}
