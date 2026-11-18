import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeysService, HOTKEYS_CATALOG, type HotkeyAction } from './hotkeys.service';
import { BinanceRepricerService } from './binance-repricer.service';

describe('HotkeysService', () => {
  let service: HotkeysService;
  let repricer: BinanceRepricerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HotkeysService);
    repricer = TestBed.inject(BinanceRepricerService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should register actions and trigger them', () => {
    let triggered = false;
    const unreg = service.register('SYNC', () => {
      triggered = true;
    });

    service.trigger('SYNC');
    expect(triggered).toBe(true);

    triggered = false;
    unreg();
    service.trigger('SYNC');
    expect(triggered).toBe(false);
  });

  it('should toggle cheat sheet modal', () => {
    expect(service.isCheatSheetOpen()).toBe(false);
    service.openModal();
    expect(service.isCheatSheetOpen()).toBe(true);
    service.closeModal();
    expect(service.isCheatSheetOpen()).toBe(false);
    service.toggleModal();
    expect(service.isCheatSheetOpen()).toBe(true);
  });

  it('should trigger kill-switch on Escape key if repricer is running', () => {
    repricer.start();
    expect(repricer.isActive()).toBe(true);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(escEvent);

    expect(repricer.isActive()).toBe(false);
  });

  it('supports microstructure desk hotkeys (L, M, T, 1, 2, 3) outside form fields and includes them in HOTKEYS_CATALOG', () => {
    const fired: HotkeyAction[] = [];
    const actions: HotkeyAction[] = [
      'TOGGLE_CLEAN_MODE',
      'APPLY_MAKER_OPTIMAL',
      'APPLY_TAKER_VWAP',
      'BRACKET_1',
      'BRACKET_2',
      'BRACKET_3',
    ];
    for (const action of actions) {
      service.register(action, () => fired.push(action));
      expect(HOTKEYS_CATALOG.some((item) => item.action === action)).toBe(true);
    }

    const keys = ['l', 'M', 't', '1', '2', '3'];
    for (const key of keys) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }

    expect(fired).toEqual(actions);
  });

  it('ignores microstructure hotkeys inside form fields and when modifier keys are held', () => {
    const spy = vi.fn();
    service.register('TOGGLE_CLEAN_MODE', spy);
    service.register('APPLY_TAKER_VWAP', spy);
    service.register('BRACKET_1', spy);

    const inputEl = document.createElement('input');
    document.body.appendChild(inputEl);
    try {
      const inputEvent = new KeyboardEvent('keydown', { key: 'l', bubbles: true });
      inputEl.dispatchEvent(inputEvent);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      inputEl.remove();
    }

    const selectEl = document.createElement('select');
    document.body.appendChild(selectEl);
    try {
      const selectEvent = new KeyboardEvent('keydown', { key: '1', bubbles: true });
      selectEl.dispatchEvent(selectEvent);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      selectEl.remove();
    }

    // Ctrl+T must not trigger APPLY_TAKER_VWAP
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
    expect(spy).not.toHaveBeenCalled();
  });
});
