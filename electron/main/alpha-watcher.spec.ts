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
const { clearBinanceP2pCacheForTesting } = await import('./ipc/handlers');

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
    clearBinanceP2pCacheForTesting();

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
    clearBinanceP2pCacheForTesting();
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

describe('AlphaWatcher — fetchBinanceP2pShared, filtro de calidad, conversión USDT y ciclo', () => {
  let db: Partial<P2PDatabaseService>;
  let send: ReturnType<typeof vi.fn>;
  let win: BrowserWindow;

  beforeEach(() => {
    fetchMock.mockReset();
    shownNotifications.length = 0;
    clearTreasurySnapshot();
    clearBinanceP2pCacheForTesting();
    db = {
      saveStrategyPlan: vi.fn(),
      recordMarketLearning: vi.fn(),
      saveEngramObservation: vi.fn(),
    };
    send = vi.fn();
    win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow;
  });

  afterEach(() => {
    vi.useRealTimers();
    clearTreasurySnapshot();
  });

  it('usa el fetcher compartido inyectable sin tocar net.fetch directo y filtra ofertas bait/outlier', async () => {
    const sharedFetch = vi.fn(async (params: { tradeType: 'BUY' | 'SELL' }) => {
      if (params.tradeType === 'BUY') {
        return {
          code: '000000',
          data: [
            // Low finish-rate bait + extreme outlier
            { adv: { advNo: 'bait-1', price: '10.00', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'Bait', monthFinishRate: 0.45, monthOrderCount: 3 } },
            { adv: { advNo: 'good-1', price: '88.00', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'Pro1', monthFinishRate: 0.98, monthOrderCount: 240 } },
            { adv: { advNo: 'good-2', price: '88.20', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'Pro2', monthFinishRate: 0.97, monthOrderCount: 180 } },
          ],
        };
      }
      return {
        code: '000000',
        data: [
          { adv: { advNo: 'bait-s', price: '500.00', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'Outlier', monthFinishRate: 0.5, monthOrderCount: 2 } },
          { adv: { advNo: 'good-s1', price: '89.35', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'ProS1', monthFinishRate: 0.99, monthOrderCount: 300 } },
          { adv: { advNo: 'good-s2', price: '89.10', maxSingleTransAmount: '250000' }, advertiser: { nickName: 'ProS2', monthFinishRate: 0.96, monthOrderCount: 150 } },
        ],
      };
    });

    setTreasurySnapshot(buildSnapshot());
    const watcher = new (AlphaWatcher as unknown as new (...args: unknown[]) => InstanceType<typeof AlphaWatcher>)(
      db as P2PDatabaseService,
      () => win,
      new RiskGatekeeperAgent(),
      sharedFetch,
    );

    await watcher.runScanCycle();

    expect(sharedFetch).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.saveStrategyPlan).toHaveBeenCalledTimes(1);
    const plan = (db.saveStrategyPlan as ReturnType<typeof vi.fn>).mock.calls[0][0] as StrategyPlanRecord;
    // Qualified best buy = 88.00, qualified best sell = 89.35 -> 1.18% net spread
    expect(plan.expectedNetSpreadPct).toBe(1.18);
  });

  it('convierte el volumen y límite de tesorería VES a USDT usando la tasa viva antes del Gatekeeper', async () => {
    // 390,000 VES spent / 440,000 VES limit at ~88.68 VES/USDT = ~4,398 USDT spent vs ~4,962 USDT limit.
    // Adding 1,000 USDT ticket pushes projected volume to ~5,398 USDT > 4,962 USDT -> MUST VETO!
    // Without VES->USDT conversion, 390,000 + 1,000 < 440,000 would have wrongly approved.
    setTreasurySnapshot(
      buildSnapshot({
        totalSpentTodayVes: 390000,
        totalDailyLimitVes: 440000,
      }),
    );

    const sharedFetch = vi.fn(async (params: { tradeType: 'BUY' | 'SELL' }) => ({
      code: '000000',
      data: [
        {
          adv: { advNo: '1', price: params.tradeType === 'BUY' ? '88.00' : '89.35', maxSingleTransAmount: '250000' },
          advertiser: { monthFinishRate: 0.99, monthOrderCount: 200 },
        },
      ],
    }));

    const watcher = new (AlphaWatcher as unknown as new (...args: unknown[]) => InstanceType<typeof AlphaWatcher>)(
      db as P2PDatabaseService,
      () => win,
      new RiskGatekeeperAgent(),
      sharedFetch,
    );

    await watcher.runScanCycle();

    expect(db.saveStrategyPlan).not.toHaveBeenCalled();
    const payload = send.mock.calls[0] as [string, { persisted: boolean; riskVerdict: { status: string } }];
    expect(payload[1].persisted).toBe(false);
    expect(payload[1].riskVerdict.status).toBe('VETOED');
  });

  it('reinicia el intervalo al cambiar pollIntervalSeconds y registra consecutiveErrors/lastError', async () => {
    vi.useFakeTimers();
    const sharedFetch = vi.fn(async () => {
      throw new Error('Binance timeout simulated');
    });

    const watcher = new (AlphaWatcher as unknown as new (...args: unknown[]) => InstanceType<typeof AlphaWatcher>)(
      db as P2PDatabaseService,
      () => win,
      new RiskGatekeeperAgent(),
      sharedFetch,
    );

    watcher.start();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    watcher.setConfig({ pollIntervalSeconds: 45 });
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 45000);

    await watcher.runScanCycle();
    const status = watcher.getStatus() as { consecutiveErrors?: number; lastError?: string | null };
    expect(status.consecutiveErrors).toBe(1);
    expect(status.lastError).toContain('Binance timeout simulated');

    watcher.stop();
  });
});
