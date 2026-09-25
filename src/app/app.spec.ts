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

  it('should render a nav with 11 feature links and mobile bottom nav', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.sidebar .nav a')).toHaveLength(11);
    expect(compiled.querySelectorAll('.mobile-bottom-nav .bottom-tab')).toHaveLength(4);
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

    it('toggleTheme() flips through the 3 themes and persists the choice', () => {
      const fixture = TestBed.createComponent(App);
      const c = fixture.componentInstance;
      fixture.detectChanges();

      // dark -> apple-dark
      c.toggleTheme();
      expect(c.theme()).toBe('apple-dark');
      expect(localStorage.getItem('p2p.theme')).toBe('apple-dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('apple-dark');

      // apple-dark -> light
      c.toggleTheme();
      expect(c.theme()).toBe('light');
      expect(localStorage.getItem('p2p.theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      // light -> dark
      c.toggleTheme();
      expect(c.theme()).toBe('dark');
      expect(localStorage.getItem('p2p.theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('initialTheme() honors a stored apple-dark or light preference', () => {
      localStorage.setItem('p2p.theme', 'apple-dark');
      let fixture = TestBed.createComponent(App);
      expect(fixture.componentInstance.theme()).toBe('apple-dark');

      localStorage.setItem('p2p.theme', 'light');
      fixture = TestBed.createComponent(App);
      expect(fixture.componentInstance.theme()).toBe('light');
    });

    it('renders the toggle button with the current theme label', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Modo oscuro');
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
