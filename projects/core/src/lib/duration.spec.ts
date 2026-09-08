import { describe, it, expect } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('renders sub-minute durations as only minutes (rounded to nearest sec)', () => {
    expect(formatDuration(30_000)).toBe('0m');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(59_000)).toBe('0m');
    expect(formatDuration(61_400)).toBe('1m');
  });

  it('renders hour+ durations as Xh Ym', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
    expect(formatDuration(12_600_000)).toBe('3h 30m');
  });

  it('renders minute-only durations as Ym', () => {
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(3_540_000)).toBe('59m');
  });

  it('maps zero, negative, and non-finite input to 0m', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5000)).toBe('0m');
    expect(formatDuration(NaN)).toBe('0m');
    expect(formatDuration(Infinity)).toBe('0m');
  });
});
