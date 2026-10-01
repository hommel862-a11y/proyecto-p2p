import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StrategyPlanRecord } from './db/database';
import type { P2PDatabaseService } from './db/database';
import type { BrowserWindow } from 'electron';
import type { TreasurySnapshotDto } from '../shared/types';

const { fetchMock, shownNotifications } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  shownNotifications: [] as { title: string; body: string }[],
}));

// `alpha-watcher.ts` imports `net` and `Notification` as values from electron, which cannot
// be loaded outside the Electron runtime. The orderbook is injected here so the scan cycle is
// exercised end to end without touching the network.
vi.mock('electron', () => ({
  net: { fetch: fetchMock },
  BrowserWindow: class {},
  Notification: class {
    constructor(private readonly options: { title: string; body: string }) {}
    static isSupported(): boolean {
      return true;
    }
    show(): void {
      shownNotifications.push(this.options);
    }
  },
}));

const { AlphaWatcher } = await import('./alpha-watcher');
const { RiskGatekeeperAgent } = await import('./agents/risk-gatekeeper-agent');
const { setTreasurySnapshot, clearTreasurySnapshot } = await import('./ipc/treasury-snapshot');

/**
 * Fake Binance P2P book. Only the top of book is consumed by the watcher, so a single level
 * per side is enough. BUY 88.00 / SELL 89.35 yields a 1.18% net spread, above the default
 * 1.15% threshold.
 */
function stubOrderbook(buyPrice: string, sellPrice: string): void {
  fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { tradeType: 'BUY' | 'SELL' };
    const price = body.tradeType === 'BUY' ? buyPrice : sellPrice;
    return {
      ok: true,
      json: async () => ({
        data: [{ adv: { price, maxSingleTransAmount: '250000' } }],
      }),
    };
  });
}

function buildSnapshot(overrides: Partial<TreasurySnapshotDto> = {}): TreasurySnapshotDto {
  return {
    accounts: [],
    totalBalanceVes: 240000,
    totalSpentTodayVes: 0,
    totalReceivedTodayVes: 0,
    totalDailyLimitVes: 440000,
    nearLimitCount: 0,
    overLimitCount: 0,
    disabledCount: 0,
    saturatedCount: 0,
    rotationRecommendationId: null,
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe('AlphaWatcher — veto institucional antes de persistir (ODD T3 / C1)', () => {
  let db: Partial<P2PDatabaseService>;
  let send: ReturnType<typeof vi.fn>;
  let win: BrowserWindow;

  beforeEach(() => {
    fetchMock.mockReset();
    shownNotifications.length = 0;
    clearTreasurySnapshot();

    db = {
      saveStrategyPlan: vi.fn(),
      recordMarketLearning: vi.fn(),
      saveEngramObservation: vi.fn(),
    };
    send = vi.fn();
    win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow;
  });

  afterEach(() => {
    clearTreasurySnapshot();
  });

  function buildWatcher(): InstanceType<typeof AlphaWatcher> {
    // A real gatekeeper, injected: the point of these tests is the wiring, not a stub verdict.
    return new AlphaWatcher(db as P2PDatabaseService, () => win, new RiskGatekeeperAgent());
  }

  /**
   * The scan cycle also runs the macro/BCV monitor, which writes its own Engram observations
   * and native alerts. Assertions therefore look for the watcher's own veto trail instead of
   * asserting the absence of every side effect.
   */
  function vetoObservations(): { topicKey: string }[] {
    return (db.saveEngramObservation as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as { topicKey: string })
      .filter((obs) => obs.topicKey.startsWith('alpha/veto-'));
  }

  function p2pNotifications(): { title: string; body: string }[] {
    return shownNotifications.filter((n) => n.title.includes('P2P'));
  }

  it('persiste el plan y lo notifica cuando la tesorería real está sana', async () => {
    setTreasurySnapshot(buildSnapshot());
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).toHaveBeenCalledTimes(1);
    const persisted = (db.saveStrategyPlan as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as StrategyPlanRecord;
    expect(persisted.status).toBe('PROPOSED');
    expect(persisted.expectedNetSpreadPct).toBe(1.18);

    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload[0]).toBe('copilot:alpha-opportunity-detected');
    expect(payload[1].persisted).toBe(true);
    expect((payload[1].riskVerdict as { status: string }).status).toBe('APPROVED');
    expect(vetoObservations()).toHaveLength(0);
  });

  it('VETEA y NO persiste cuando el snapshot anuncia una cuenta sobre el límite diario', async () => {
    setTreasurySnapshot(buildSnapshot({ overLimitCount: 1 }));
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).not.toHaveBeenCalled();
    expect(db.recordMarketLearning).not.toHaveBeenCalled();

    const obs = (db.saveEngramObservation as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as { topicKey: string; type: string })
      .find((o) => o.topicKey.startsWith('alpha/veto-'));
    expect(obs).toBeDefined();
    expect(obs?.topicKey).toMatch(/^alpha\/veto-ALPHA-/);
    expect(obs?.type).toBe('decision');

    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload[1].persisted).toBe(false);
    const verdict = payload[1].riskVerdict as { status: string; vetoReason?: string };
    expect(verdict.status).toBe('VETOED');
    expect(verdict.vetoReason).toContain('TESORERÍA REAL');

    // A blocked spread must never be announced as an opportunity.
    expect(p2pNotifications()).toHaveLength(1);
    expect(p2pNotifications()[0].title).toContain('bloqueada por riesgo');
  });

  it('VETEA por cuenta DISABLED anunciada en el snapshot (semántica T2)', async () => {
    setTreasurySnapshot(buildSnapshot({ disabledCount: 1 }));
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).not.toHaveBeenCalled();
    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    const verdict = payload[1].riskVerdict as { vetoReason?: string };
    expect(verdict.vetoReason).toContain('DISABLED');
  });

  it('VETEA por saturación de velocidad bancaria', async () => {
    setTreasurySnapshot(buildSnapshot({ saturatedCount: 2 }));
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).not.toHaveBeenCalled();
    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    const verdict = payload[1].riskVerdict as { vetoReason?: string };
    expect(verdict.vetoReason).toContain('VELOCIDAD BANCARIA');
  });

  it('persiste con advertencias cuando una cuenta se acerca al límite diario', async () => {
    setTreasurySnapshot(buildSnapshot({ nearLimitCount: 1 }));
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload[1].persisted).toBe(true);
    const verdict = payload[1].riskVerdict as { status: string; warnings: string[] };
    expect(verdict.status).toBe('APPROVED_WITH_WARNINGS');
    expect(verdict.warnings.join(' ')).toContain('cerca');
  });

  it('VETEA por regla de oro cuando el umbral operativo queda bajo el mínimo institucional', async () => {
    // 88.00 -> 88.66 is a 0.40% net spread: above the (mis)configured 0.30% watcher
    // threshold, below the 0.50% institutional floor.
    setTreasurySnapshot(buildSnapshot());
    stubOrderbook('88.00', '88.66');

    const watcher = buildWatcher();
    watcher.setConfig({ minNetSpreadPct: 0.3 });
    await watcher.runScanCycle();

    expect(db.saveStrategyPlan).not.toHaveBeenCalled();
    const payload = send.mock.calls[0] as [string, Record<string, unknown>];
    const verdict = payload[1].riskVerdict as { vetoReason?: string };
    expect(verdict.vetoReason).toContain('regla de oro institucional');
  });

  it('cae a los literales pre-puente cuando el renderer nunca anunció snapshot', async () => {
    clearTreasurySnapshot();
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    // 4.500 (fallback) + 1.000 = 5.500 <= 15.000 (fallback): legacy behavior preserved.
    expect(db.saveStrategyPlan).toHaveBeenCalledTimes(1);
  });
});

/**
 * Doctrine under test: a missing measurement is `null` plus a declared absence, never a number.
 *
 * The scan cycle measured the P2P book but not the official BCV rate, and answered
 * `const estimatedBcvRate = 65.5; // Reference anchor`. With BUY at 88.00 that invents a 34.35%
 * gap — past the engine's own 28% CRITICAL threshold — so the watcher pushed a
 * "BRECHA CAMBIARIA CRÍTICA" native alert telling the operator to shrink the fiat book, on the
 * strength of a number nobody measured. `// Reference anchor` is what made it read as authority.
 * The USDT leg had the mirror problem: `evaluateUsdtDepegEvent(1.0)` is the peg, not a reading, so
 * the depeg monitor could never fire.
 */
describe('AlphaWatcher — el monitor macro no mide lo que no midió', () => {
  let db: Partial<P2PDatabaseService>;
  let send: ReturnType<typeof vi.fn>;
  let win: BrowserWindow;

  beforeEach(() => {
    fetchMock.mockReset();
    shownNotifications.length = 0;
    clearTreasurySnapshot();
    setTreasurySnapshot(buildSnapshot());

    db = {
      saveStrategyPlan: vi.fn(),
      recordMarketLearning: vi.fn(),
      saveEngramObservation: vi.fn(),
    };
    send = vi.fn();
    win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow;
  });

  afterEach(() => {
    clearTreasurySnapshot();
  });

  function buildWatcher(): InstanceType<typeof AlphaWatcher> {
    return new AlphaWatcher(db as P2PDatabaseService, () => win, new RiskGatekeeperAgent());
  }

  function proactiveAlertPayloads(): Record<string, unknown>[] {
    return send.mock.calls
      .filter((call) => call[0] === 'copilot:proactive-event-alert')
      .map((call) => call[1] as Record<string, unknown>);
  }

  function evidenceObservations(): { topicKey: string; what: string; learned: string }[] {
    return (db.saveEngramObservation as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as { topicKey: string; what: string; learned: string })
      .filter((obs) => obs.topicKey.startsWith('alpha/declared-absence-'));
  }

  it('NUNCA publica una alerta de brecha BCV construida sobre la tasa oficial inventada', async () => {
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    // 88.00 vs 65.5 = 34.35% >= 28% -> the engine used to raise a CRITICAL gap alert here.
    expect(proactiveAlertPayloads()).toHaveLength(0);
    const serialized = JSON.stringify(
      (db.saveEngramObservation as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
    );
    expect(serialized).not.toContain('65.5');
  });

  it('declara la ausencia nombrando las fuentes que la satisfarían', async () => {
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    const absences = evidenceObservations();
    expect(absences.length).toBe(1);
    expect(absences[0].learned).toMatch(/get_bcv_rates/);
    // The USDT leg is a declared absence too: nothing in this process fetches a USDT/USD spot.
    expect(absences[0].learned).toMatch(/USDTUSD/);
    // The record itself must read as an absence, not as a result: no number, and the two
    // sources named so an operator knows what would close the gap.
    expect(absences[0].what).toContain('N/D');
  });

  it('sigue reportando el spread que el watcher sí midió en el libro', async () => {
    // Regression guard on the opposite side: declaring the BCV/spot absence must not silence the
    // detection the watcher is actually qualified to make.
    stubOrderbook('88.00', '89.35');

    await buildWatcher().runScanCycle();

    expect(db.saveStrategyPlan).toHaveBeenCalledTimes(1);
    expect(evidenceObservations().length).toBe(1);
  });
});
