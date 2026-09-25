import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiSettingsModalComponent } from './api-settings-modal.component';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { ToastService } from '../../core/toast.service';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ApiSettingsModalComponent', () => {
  let component: ApiSettingsModalComponent;
  let fixture: ComponentFixture<ApiSettingsModalComponent>;

  const mockCotizave = {
    apiKey: signal(''),
    loading: signal(false),
    setApiKey: vi.fn(),
    fetchRates: vi.fn().mockResolvedValue(undefined),
  };

  const mockBinance = {
    usePublicCorsProxy: signal(false),
    customProxyUrl: signal(''),
    loading: signal(false),
    setUsePublicProxy: vi.fn(),
    fetchMarketDepth: vi.fn().mockResolvedValue({ buyOffers: [], sellOffers: [] }),
  };

  const mockTelegram = {
    config: signal({ botToken: '', chatId: '', alertsEnabled: true }),
    saveConfig: vi.fn(),
    getBotInfo: vi.fn().mockResolvedValue({ id: 1, username: 'test_bot' }),
  };

  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiSettingsModalComponent],
      providers: [
        { provide: CotizaveService, useValue: mockCotizave },
        { provide: BinanceP2pService, useValue: mockBinance },
        { provide: TelegramWorkerService, useValue: mockTelegram },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiSettingsModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the modal component', () => {
    expect(component).toBeTruthy();
  });

  it('should emit close event when clicking close button', () => {
    let closed = false;
    component.close.subscribe(() => {
      closed = true;
    });

    const closeBtn = fixture.nativeElement.querySelector('.btn-close');
    closeBtn.click();
    expect(closed).toBe(true);
  });

  it('should save Cotizave API key', () => {
    component.cotizaveKeyInput.set('cz_test_123');
    component.saveCotizave();
    expect(mockCotizave.setApiKey).toHaveBeenCalledWith('cz_test_123');
  });

  it('should toggle proxy on Binance service', () => {
    component.onProxyToggle({ target: { checked: true } } as unknown as Event);
    expect(mockBinance.setUsePublicProxy).toHaveBeenCalledWith(true);
  });
});
