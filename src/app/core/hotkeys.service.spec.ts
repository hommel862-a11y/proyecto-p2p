import { TestBed } from '@angular/core/testing';
import { HotkeysService } from './hotkeys.service';
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
});
