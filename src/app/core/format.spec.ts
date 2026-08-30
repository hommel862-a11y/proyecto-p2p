import { describe, it, expect } from 'vitest';
import { fmtVes, fmtUsd, fmtPct, fmtNum } from './format';

describe('es-VE formatters (shared with the ves/usdt/pct/num pipes)', () => {
  it('fmtVes | ves formats a bolívar amount with 2 decimals and Bs suffix', () => {
    expect(fmtVes(20000)).toBe('20.000,00 Bs');
    expect(fmtVes(25.5)).toBe('25,50 Bs');
  });

  it('fmtUsd | usdt formats a USDT amount with 2 decimals and USDT suffix', () => {
    expect(fmtUsd(25)).toBe('25,00 USDT');
    expect(fmtUsd(0.5)).toBe('0,50 USDT');
  });

  it('fmtPct | pct formats a percentage (ratio) in es-VE', () => {
    expect(fmtPct(0.015)).toBe('1,50%');
    expect(fmtPct(1)).toBe('100,00%');
  });

  it('fmtNum | num formats a plain number with grouping separators', () => {
    expect(fmtNum(1200)).toBe('1.200,00');
    expect(fmtNum(0, 4)).toBe('0,0000');
  });

  it('fmtNum | num honors a custom digit count and clamps non-finite digits', () => {
    expect(fmtNum(1.2345, 3)).toBe('1,235');
    expect(fmtNum(5, Number.NaN)).toBe('5,00');
  });

  it('formatters are NaN/Infinity-safe (collapse to 0)', () => {
    expect(fmtVes(Number.NaN)).toBe('0,00 Bs');
    expect(fmtUsd(Number.NEGATIVE_INFINITY)).toBe('0,00 USDT');
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('0,00');
  });
});
