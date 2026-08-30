import { computeSpread } from './spread';

describe('computeSpread', () => {
  it('Scenario A (verified): 800/820, 25 USDT -> 25 USDT received, 20500 VES, +500 Bs, no commission', () => {
    const r = computeSpread(800, 820, 25, 'USDT');
    expect(r.usdtReceived).toBe(25);
    expect(r.vesReceived).toBe(20500);
    expect(r.unitSpread).toBe(20);
    expect(r.gainVes).toBe(500);
    expect(r.netVesAfterCommission).toBe(20500);
  });

  it('Scenario B (VES input): 20000 VES @800/820 -> 25 USDT, 20500 VES received', () => {
    const r = computeSpread(800, 820, 20000, 'VES');
    expect(r.usdtReceived).toBe(25);
    expect(r.vesReceived).toBe(20500);
  });

  it('Scenario D (commission): 0.35% seller commission -> net 20428.25 Bs', () => {
    const r = computeSpread(800, 820, 25, 'USDT', 0.0035);
    expect(r.netVesAfterCommission).toBe(20428.25);
  });

  it('rejects zero or negative buy/sell price and amount', () => {
    expect(() => computeSpread(0, 820, 25, 'USDT')).toThrow(/positivo/i);
    expect(() => computeSpread(-5, 820, 25, 'USDT')).toThrow(/positivo/i);
    expect(() => computeSpread(800, 0, 25, 'USDT')).toThrow(/positivo/i);
    expect(() => computeSpread(800, 820, 0, 'USDT')).toThrow(/positivo/i);
  });

  it('rejects commission rate outside 0..0.35%', () => {
    expect(() => computeSpread(800, 820, 25, 'USDT', 0.01)).toThrow(/0\.35/);
  });
});
