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

  constructor() {
    try {
      document.documentElement.setAttribute('data-theme', this.theme());
    } catch {
      /* sin DOM */
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
