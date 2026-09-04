import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TradeTimerService, type TradePreset } from './trade-timer.service';
import { P2P_STORAGE } from './storage';
import { MemoryStorage } from './memory-storage';

describe('TradeTimerService', () => {
  let service: TradeTimerService;
  let mem: MemoryStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [TradeTimerService, { provide: P2P_STORAGE, useValue: mem }],
    });
    service = TestBed.inject(TradeTimerService);
  });

  afterEach(() => {
    service.reset();
    vi.useRealTimers();
  });

  it('initializes in idle state with 0 elapsed time', () => {
    expect(service.state()).toBe('idle');
    expect(service.elapsedMs()).toBe(0);
    expect(service.formattedTime()).toBe('00:00');
    expect(service.pendingPreset()).toBeNull();
  });

  it('starts timer and stores trade preset', () => {
    const preset: TradePreset = {
      pair: 'USDT',
      type: 'buy',
      price: 800,
      vesAmount: 8000,
      usdtAmount: 10,
    };

    service.start(preset);
    expect(service.state()).toBe('running');
    expect(service.pendingPreset()).toEqual(preset);

    vi.advanceTimersByTime(2000);
    expect(service.elapsedMs()).toBeGreaterThanOrEqual(2000);
    expect(service.formattedTime()).toBe('00:02');
  });

  it('pauses and resumes timer accurately', () => {
    service.start();
    vi.advanceTimersByTime(3000);

    service.pause();
    expect(service.state()).toBe('paused');
    const pausedTime = service.elapsedMs();

    vi.advanceTimersByTime(5000);
    expect(service.elapsedMs()).toBe(pausedTime);

    service.resume();
    expect(service.state()).toBe('running');
    vi.advanceTimersByTime(2000);
    expect(service.elapsedMs()).toBeGreaterThanOrEqual(pausedTime + 2000);
  });

  it('consumes pending preset once and clears it', () => {
    const preset: TradePreset = {
      pair: 'EUR',
      type: 'sell',
      price: 870,
      vesAmount: 8700,
      usdtAmount: 10,
    };

    service.start(preset);
    const consumed = service.consumePendingPreset();
    expect(consumed).toEqual(preset);
    expect(service.pendingPreset()).toBeNull();
    expect(service.consumePendingPreset()).toBeNull();
  });

  it('stops and returns final duration, returning state to idle', () => {
    service.start();
    vi.advanceTimersByTime(4500);

    const duration = service.stop();
    expect(duration).toBeGreaterThanOrEqual(4500);
    expect(service.state()).toBe('idle');
    expect(service.elapsedMs()).toBe(0);
  });
});
