import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchCrossExchangeSpreadTool } from './fetch_cross_exchange_spread.js';

/**
 * The defect under test.
 *
 * `fetch_cross_exchange_spread` used to synthesise the whole comparison:
 *
 *   const baseRate = fiat === 'VES' ? 79.2 : ...;
 *   { exchange: 'Binance P2P', buyRate: baseRate * 0.992, activeMerchants: 48 }
 *   { exchange: 'OKX P2P',      buyRate: baseRate * 0.994, activeMerchants: 15 }
 *   { exchange: 'KuCoin P2P',   buyRate: baseRate * 0.985, activeMerchants: 9 }
 *
 * and then computed `crossArbitrageOpportunity` by sorting ALL of those quotes
 * together. `isViable: crossSpreadPct >= 1.5` was therefore a tradeability
 * verdict derived from prices nobody quoted — and the winning "venue" was
 * usually one of the invented ones, because the fabricated base was the only
 * thing keeping them in the ranking.
 *
 * Worse, Binance P2P quotes are genuinely fetchable without credentials from
 * the public C2C endpoint, so a real reading was available and was not taken.
 *
 * The rule: an arbitrage verdict may only be built from quotes marked LIVE.
 * Everything else is either absent or explicitly quarantined from the verdict.
 */

type FetchMock = ReturnType<typeof vi.fn>;

function binanceResponse(prices: number[]): unknown {
  return {
    code: '000000',
    data: prices.map((price, i) => ({
      adv: {
        advNo: `adv-${i}`,
        price: String(price),
        fiatUnit: 'VES',
        asset: 'USDT',
        minSingleTransAmount: '100',
        maxSingleTransAmount: '500000',
        tradeMethods: [{ tradeMethodName: 'Banesco' }],
      },
      advertiser: {
        nickName: `maker-${i}`,
        monthOrderCount: 120,
        monthFinishRate: 0.98,
      },
    })),
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.BYBIT_API_KEY;
  delete process.env.BYBIT_API_SECRET;
  delete process.env.ELDORADO_CLIENT_ID;
  delete process.env.ELDORADO_REFERRAL_ID;
  delete process.env.ELDORADO_API_KEY;
});

describe('fetch_cross_exchange_spread — sin dato no hay veredicto', () => {
  it('never publishes a quote for a venue it did not read', async () => {
    // No credentials, and Binance unreachable: there is no live source at all.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    expect(res.rateStatus).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
    expect(res.actionable).toBe(false);
    // No venue may appear with a price, because no venue was read.
    expect(res.exchanges).toEqual([]);
    expect(res.crossArbitrageOpportunity).toBeNull();
  });

  it('does not emit an isViable verdict built from invented prices', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    // The old shape always carried this. A missing record is not a passed test.
    expect(res).not.toHaveProperty('crossArbitrageOpportunity.isViable');
    expect(res).not.toHaveProperty('crossArbitrageOpportunity.netSpreadPct');
  });

  it('never invents activeMerchants, which no endpoint here reports', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    const serialised = JSON.stringify(res);
    // 48 / 22 / 15 / 9 were the fabricated merchant counts.
    expect(serialised).not.toContain('activeMerchants');
  });

  it('never derives a quote from the fabricated VES base rate', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    const serialised = JSON.stringify(res);
    // The base never appeared verbatim, only its products: 79.2*0.992=78.49,
    // 79.2*1.012=80.15, 79.2*0.988=78.25, 79.2*0.985=78.01.
    for (const fabricated of ['78.49', '80.15', '78.25', '78.01', '79.2']) {
      expect(serialised).not.toContain(fabricated);
    }
  });
});

describe('fetch_cross_exchange_spread — con dato real el número real sale', () => {
  it('reads Binance P2P from the public endpoint and reports the real spread', async () => {
    // Binance C2C semantics, per the vendor parser:
    //   tradeType BUY  -> makers selling crypto  -> these are your asks (cheapest = your buy price)
    //   tradeType SELL -> makers buying crypto   -> these are your bids (dearest = your sell price)
    // BUY: 79.00 and 78.40 -> best buy 78.40
    // SELL: 80.60 and 81.20 -> best sell 80.60
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const json =
        body.tradeType === 'BUY'
          ? binanceResponse([79.0, 78.4])
          : binanceResponse([80.6, 81.2]);
      return { ok: true, status: 200, json: async () => json } as never;
    }) as unknown as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    expect(res.rateStatus).toBeUndefined();
    expect(res.actionable).toBe(false);

    const binance = (res.exchanges as Array<{ exchange: string; source: string; buyRate: number; sellRate: number }>).find(
      (e) => e.exchange === 'Binance P2P',
    );
    expect(binance).toBeDefined();
    expect(binance!.source).toBe('LIVE');
    // Cheapest ask (makers selling) is 78.40, dearest bid (makers buying) is 81.20.
    expect(binance!.buyRate).toBe(78.4);
    expect(binance!.sellRate).toBe(81.2);
  });

  it('computes the verdict from real quotes only, and still needs two venues', async () => {
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const json =
        body.tradeType === 'BUY' ? binanceResponse([78.4]) : binanceResponse([80.6]);
      return { ok: true, status: 200, json: async () => json } as never;
    }) as unknown as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    // A single venue is not an arbitrage. Self-arbitrage across your own book
    // is just the bid/ask spread, which is a cost, not an opportunity.
    expect(res.crossArbitrageOpportunity).toBeNull();
    expect(res.expectedSource).toContain('Binance');
  });

  it('builds a real cross-venue verdict when two live venues disagree', async () => {
    process.env.BYBIT_API_KEY = 'k';
    process.env.BYBIT_API_SECRET = 's';

    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const target = String(url);
      if (target.includes('p2p.binance.com')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const json =
          body.tradeType === 'BUY' ? binanceResponse([78.4]) : binanceResponse([80.6]);
        return { ok: true, status: 200, json: async () => json } as never;
      }
      // Bybit: side 1 = SELL ads (asks) -> 78.0; side 0 = BUY ads (bids) -> 79.0.
      // So Bybit is the cheap place to buy but NOT the dear place to sell:
      // the cross leg has to land on Binance.
      const body = JSON.parse(String(init?.body ?? '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { items: [{ price: body.side === 1 ? '78.0' : '79.0' }] } }),
      } as never;
    }) as unknown as FetchMock;

    const res = await fetchCrossExchangeSpreadTool.execute({
      asset: 'USDT',
      fiat: 'VES',
      paymentMethod: 'ALL',
    } as never);

    const opp = res.crossArbitrageOpportunity as {
      buyOn: string;
      sellOn: string;
      netSpreadPct: number;
      isViable: boolean;
    } | null;

    expect(opp).not.toBeNull();
    // Buy cheap on Bybit (78.0), sell dear on Binance (80.6).
    expect(opp!.buyOn).toBe('Bybit P2P');
    expect(opp!.sellOn).toBe('Binance P2P');
    expect(opp!.netSpreadPct).toBeCloseTo(((80.6 - 78.0) / 78.0) * 100, 1);
    expect(opp!.isViable).toBe(opp!.netSpreadPct >= 1.5);
  });
});