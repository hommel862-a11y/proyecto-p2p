import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('p2p');
  readonly theme = signal<'dark' | 'light'>(this.initialTheme());
  /** Real app version when running under Electron; falls back to the web build. */
  readonly version = signal<string>('1.0.0');

  constructor() {
    try {
      document.documentElement.setAttribute('data-theme', this.theme());
    } catch {
      /* sin DOM */
    }
    this.resolveVersion();
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
}
