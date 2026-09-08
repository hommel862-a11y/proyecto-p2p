import { describe, it, expect } from 'vitest';
import { clampNonNegative, clampAtLeast, roundMoney, clampMoney } from './money';

describe('clampNonNegative', () => {
  it('passes positive values through unchanged', () => {
    expect(clampNonNegative(500)).toBe(500);
    expect(clampNonNegative(0.5)).toBe(0.5);
  });

  it('maps zero to itself', () => {
    expect(clampNonNegative(0)).toBe(0);
  });

  it('collapses negatives to 0', () => {
    expect(clampNonNegative(-5)).toBe(0);
    expect(clampNonNegative(-0.1)).toBe(0);
  });

  it('collapses NaN, +Infinity and -Infinity to 0', () => {
    expect(clampNonNegative(NaN)).toBe(0);
    expect(clampNonNegative(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampNonNegative(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('never returns a non-finite or negative value', () => {
    for (const v of [NaN, Infinity, -Infinity, -1, 0, 1, 999.999]) {
      const r = clampNonNegative(v);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('clampAtLeast', () => {
  it('raises values below the floor to the floor', () => {
    expect(clampAtLeast(0, 1)).toBe(1);
    expect(clampAtLeast(-3, 1)).toBe(1);
  });

  it('keeps values at or above the floor', () => {
    expect(clampAtLeast(5, 1)).toBe(5);
    expect(clampAtLeast(1, 1)).toBe(1);
  });

  it('turns non-finite values into the floor', () => {
    expect(clampAtLeast(NaN, 1)).toBe(1);
    expect(clampAtLeast(Infinity, 1)).toBe(1);
  });
});

describe('roundMoney', () => {
  it('rounds numbers correctly to specified decimal places', () => {
    expect(roundMoney(123.456, 2)).toBe(123.46);
    expect(roundMoney(123.454, 2)).toBe(123.45);
    expect(roundMoney(10.5, 0)).toBe(11);
    expect(roundMoney(10.123456, 4)).toBe(10.1235);
  });

  it('handles floating point representation artifacts (e.g. 1.005 -> 1.01)', () => {
    expect(roundMoney(1.005, 2)).toBe(1.01);
  });

  it('safely handles non-finite values', () => {
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
    expect(roundMoney(-Infinity)).toBe(0);
  });
});

describe('clampMoney', () => {
  it('passes positive and zero values through unchanged', () => {
    expect(clampMoney(820)).toBe(820);
    expect(clampMoney(0)).toBe(0);
    expect(clampMoney(0.5)).toBe(0.5);
  });

  it('collapses negatives to 0', () => {
    expect(clampMoney(-1)).toBe(0);
    expect(clampMoney(-10)).toBe(0);
  });

  it('collapses NaN and ±Infinity to 0', () => {
    expect(clampMoney(NaN)).toBe(0);
    expect(clampMoney(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampMoney(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('matches clampNonNegative for all inputs (dedup alias)', () => {
    for (const v of [NaN, Infinity, -Infinity, -1, 0, 1, 999.999]) {
      expect(clampMoney(v)).toBe(clampNonNegative(v));
    }
  });
});

