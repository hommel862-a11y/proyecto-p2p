import { Component, signal, inject, DestroyRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastComponent } from './core/toast.component';
import { HotkeysModalComponent } from './shared/components/hotkeys-modal.component';
import { CommandPalette } from './shared/ui/command-palette';
import { HotkeysService } from './core/hotkeys.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastComponent, HotkeysModalComponent, CommandPalette],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('p2p');
  readonly theme = signal<'dark' | 'light'>(this.initialTheme());
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

  private initialTheme(): 'dark' | 'light' {
    try {
      return localStorage.getItem('p2p.theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
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
