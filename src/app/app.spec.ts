import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render a nav with 7 feature links', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('nav a')).toHaveLength(7);
  });

  describe('theme toggle', () => {
    beforeEach(() => {
      const store = new Map<string, string>();
      (globalThis as Record<string, unknown>)['localStorage'] = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      } as Storage;
    });

    it('defaults to dark and applies data-theme="dark" to the root element', () => {
      const fixture = TestBed.createComponent(App);
      expect(fixture.componentInstance.theme()).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('toggleTheme() flips the theme and persists the choice', () => {
      const fixture = TestBed.createComponent(App);
      const c = fixture.componentInstance;
      fixture.detectChanges();
      c.toggleTheme();
      expect(c.theme()).toBe('light');
      expect(localStorage.getItem('p2p.theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      c.toggleTheme();
      expect(c.theme()).toBe('dark');
      expect(localStorage.getItem('p2p.theme')).toBe('dark');
    });

    it('initialTheme() honors a stored light preference', () => {
      localStorage.setItem('p2p.theme', 'light');
      const fixture = TestBed.createComponent(App);
      expect(fixture.componentInstance.theme()).toBe('light');
    });

    it('renders the toggle button with the correct Spanish label', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Modo claro');
    });
  });

  describe('version resolution', () => {
    it('uses the p2p.version localStorage override when available', () => {
      const store = new Map<string, string>([['p2p.version', '1.2.3']]);
      (globalThis as Record<string, unknown>)['localStorage'] = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      } as Storage;
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      // read is sync for the localStorage path
      expect(fixture.componentInstance.version()).toBe('1.2.3');
      expect(fixture.nativeElement.textContent).toContain('v1.2.3');
    });

    it('falls back to 1.0.0 when no bridge or storage override exists', () => {
      delete (globalThis as Record<string, unknown>)['electron'];
      (globalThis as Record<string, unknown>)['localStorage'] = undefined;
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      expect(fixture.componentInstance.version()).toBe('1.0.0');
    });
  });
});
