import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Copilot } from './copilot';
import type { StrategyPlanCard } from '../../../../electron/shared/types';

describe('Copilot (2-Mode Workbench & Governance Dashboard)', () => {
  let fixture: ComponentFixture<Copilot>;
  let component: Copilot;

  beforeEach(async () => {
    if (typeof localStorage?.setItem !== 'function') {
      const store = new Map<string, string>();
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          get length() {
            return store.size;
          },
          key: (i: number) => Array.from(store.keys())[i] ?? null,
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, String(v));
          },
          removeItem: (k: string) => {
            store.delete(k);
          },
          clear: () => store.clear(),
        },
        configurable: true,
      });
    }
    localStorage.setItem('p2p.gemini.apiKey', 'legacy-secret-123');
    localStorage.setItem('p2p.ai.key.openai', 'sk-legacy-456');

    await TestBed.configureTestingModule({
      imports: [Copilot],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Copilot);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    delete (window as any).electron;
    delete (window as any).p2p;
  });

  it('creates component in workbench mode and scrubs legacy plaintext API keys from localStorage', () => {
    expect(component).toBeTruthy();
    expect(component.activeView()).toBe('workbench');
    expect(localStorage.getItem('p2p.gemini.apiKey')).toBeNull();
    expect(localStorage.getItem('p2p.ai.key.openai')).toBeNull();
  });

  it('starts strictly Zero-Seed with no fake counterparties, fake Engram rules, or hardcoded BCV rates', () => {
    expect(component.plans()).toEqual([]);
    expect(component.engramObservations()).toEqual([]);
    expect(component.liveParallelRate()).toBeNull();
    expect(component.liveBcvRate()).toBeNull();
    expect(component.liveBcvGapPct()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('SIN DATO');
    expect(fixture.nativeElement.textContent).not.toContain('Carlos Eduardo Mendoza');
  });

  it('switches cleanly between Workbench and Governance Dashboard (Ctrl+Shift+D / setView)', () => {
    expect(component.activeView()).toBe('workbench');
    component.setView('dashboard');
    fixture.detectChanges();
    expect(component.activeView()).toBe('dashboard');
    expect(fixture.nativeElement.textContent).toMatch(/cola de planes tácticos y auditoría hitl/i);
    expect(fixture.nativeElement.textContent).toMatch(/cuarentena engram/i);

    component.setView('workbench');
    fixture.detectChanges();
    expect(component.activeView()).toBe('workbench');
  });

  it('surfaces executionError and NEVER opens launcher modal or writes clipboard when executePlan fails', async () => {
    const plan: StrategyPlanCard = {
      id: 'PLAN-SIM-1',
      title: 'Compra Banesco',
      route: 'VES -> USDT',
      capitalRequiredUsdt: 1000,
      expectedNetSpreadPct: 1.05,
      expectedProfitUsdt: 10.5,
      riskLevel: 'LOW',
      rationale: 'Test',
      status: 'PROPOSED',
      esSimulado: true,
    };

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    (window as any).electron = {
      copilot: {
        executePlan: vi.fn().mockResolvedValue({
          success: false,
          error: 'VETO POR RIESGO: Excede tope diario VES.',
        }),
      },
    };

    await component.executePlan(plan);
    expect(component.executionError()).toContain('Excede tope diario VES');
    expect(component.showActionLauncher()).toBe(false);
    expect(writeTextSpy).not.toHaveBeenCalled();
  });

  it('opens launcher modal and copies ticket ONLY when executePlan returns success: true', async () => {
    const plan: StrategyPlanCard = {
      id: 'PLAN-LIVE-1',
      title: 'Compra Banesco LIVE',
      route: 'VES -> USDT',
      capitalRequiredUsdt: 1000,
      expectedNetSpreadPct: 1.05,
      expectedProfitUsdt: 10.5,
      riskLevel: 'LOW',
      rationale: 'Live book',
      status: 'PROPOSED',
      esSimulado: false,
    };

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    (window as any).electron = {
      copilot: {
        executePlan: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    await component.executePlan(plan);
    expect(component.executionError()).toBeNull();
    expect(component.showActionLauncher()).toBe(true);
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('PLAN-LIVE-1'));
  });

  it('handles Engram quarantine approve and discard via IPC', async () => {
    const reviewSpy = vi.fn().mockResolvedValue({ success: true, id: 10, status: 'active' });
    (window as any).electron = {
      copilot: {
        reviewEngramObservation: reviewSpy,
      },
    };

    component.engramObservations.set([
      {
        id: 10,
        topicKey: 'strategy/test',
        type: 'discovery',
        what: 'Regla en cuarentena',
        why: 'Auto',
        whereAffected: 'Banesco',
        learned: 'Detalle',
        confidenceScore: 0.9,
        status: 'needs_review',
      },
      {
        id: 11,
        topicKey: 'strategy/noise',
        type: 'discovery',
        what: 'Ruido',
        why: 'Auto',
        whereAffected: 'N/A',
        learned: 'Descartar',
        confidenceScore: 0.5,
        status: 'needs_review',
      },
    ]);

    await component.reviewEngramObservation({ id: 10, action: 'approve' });
    expect(reviewSpy).toHaveBeenCalledWith({ id: 10, action: 'approve' });
    expect(component.engramObservations().find((o) => o.id === 10)?.status).toBe('active');

    await component.reviewEngramObservation({ id: 11, action: 'discard' });
    expect(component.engramObservations().find((o) => o.id === 11)).toBeUndefined();
  });

  it('arms kill-switch one-way and filters slash commands', async () => {
    expect(component.treasuryMetrics().killSwitchActive).toBe(false);
    await component.triggerKillSwitch();
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH ACTIVADO');

    await component.triggerKillSwitch();
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH YA ACTIVO');

    component.onInputChange('/spr');
    expect(component.filteredSlashCommands().map((c) => c.command)).toEqual(['/spread']);
  });

  it('sanitizes HTML in renderMarkdown to prevent XSS', () => {
    const safe = component.renderMarkdown(
      '<script>alert(1)</script>**Seguro** [Click](javascript:alert(1)) [Ad](https://c2c.binance.com/es-LA/adv?code=123)',
    );
    const htmlStr = String((safe as any).changingThisBreaksApplicationSecurity || safe);
    expect(htmlStr).not.toContain('<script>');
    expect(htmlStr).toContain('&lt;script&gt;');
    expect(htmlStr).toContain('<strong>Seguro</strong>');
    expect(htmlStr).not.toContain('href="javascript:');
    expect(htmlStr).toContain('href="https://c2c.binance.com/es-LA/adv?code=123"');
  });
});
