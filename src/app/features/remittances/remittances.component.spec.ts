import '@angular/compiler';
import { Injector, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemittancesComponent } from './remittances.component';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { CotizaveService } from '../../core/cotizave.service';
import { ToastService } from '../../core/toast.service';

describe('RemittancesComponent', () => {
  let component: RemittancesComponent;
  let binanceMock: {
    marketDepth: ReturnType<typeof signal>;
  };
  let cotizaveMock: {
    refreshIfStale: ReturnType<typeof vi.fn>;
    ratesByMarket: ReturnType<typeof signal>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    binanceMock = {
      marketDepth: signal({
        bestBuyPrice: 102.5,
        bestSellPrice: 100.0,
        spread: 2.5,
        spreadPct: 2.47,
        updatedAt: Date.now(),
      } as any),
    };

    cotizaveMock = {
      refreshIfStale: vi.fn().mockResolvedValue(undefined),
      ratesByMarket: signal({
        oficial: { mid: 70.0, ask: 70.2, bid: 69.8 },
      } as any),
    };

    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: BinanceP2pService, useValue: binanceMock },
        { provide: CotizaveService, useValue: cotizaveMock },
        { provide: ToastService, useValue: toastMock },
        RemittancesComponent,
      ],
    });

    component = injector.get(RemittancesComponent);
  });

  describe('USD ⇄ VES Dual Converter', () => {
    it('initializes with default state for USD_TO_VES conversion', () => {
      expect(component.activeTab()).toBe('USD_VES_DUAL');
      expect(component.usdVesDirection()).toBe('USD_TO_VES');
      expect(component.usdVesAmount()).toBe(100);
      expect(component.usdVesDeskMarginPct()).toBe(2.5);

      const conv = component.usdVesConversion();
      expect(conv.direction).toBe('USD_TO_VES');
      expect(conv.amount).toBe(100);
      expect(conv.lines.length).toBe(3);

      const deskLine = component.usdVesDeskLine();
      const p2pLine = component.usdVesP2pLine();
      const bcvLine = component.usdVesBcvLine();

      expect(deskLine).toBeDefined();
      expect(p2pLine).toBeDefined();
      expect(bcvLine).toBeDefined();
      expect(deskLine?.result).toBeGreaterThan(0);
    });

    it('toggles direction between USD_TO_VES and VES_TO_USD and adjusts default amount', () => {
      component.toggleUsdVesDirection();
      expect(component.usdVesDirection()).toBe('VES_TO_USD');
      expect(component.usdVesAmount()).toBe(5000);

      const conv = component.usdVesConversion();
      expect(conv.direction).toBe('VES_TO_USD');
      expect(conv.amount).toBe(5000);

      const deskLine = component.usdVesDeskLine();
      expect(deskLine).toBeDefined();
      expect(deskLine?.result).toBeGreaterThan(0);

      component.toggleUsdVesDirection();
      expect(component.usdVesDirection()).toBe('USD_TO_VES');
      expect(component.usdVesAmount()).toBe(100);
    });

    it('updates amount when setUsdVesAmount is called', () => {
      component.setUsdVesAmount(500);
      expect(component.usdVesAmount()).toBe(500);
      expect(component.usdVesConversion().amount).toBe(500);
    });

    it('honors custom rate overrides for BCV and P2P', () => {
      component.usdVesCustomBcvRate.set(75.0);
      component.usdVesCustomP2pRate.set(105.0);

      expect(component.effectiveBcvRate()).toBe(75.0);
      expect(component.effectiveP2pBuyRate()).toBe(105.0);
      expect(component.effectiveP2pSellRate()).toBe(105.0);

      const conv = component.usdVesConversion();
      const bcvLine = conv.lines.find((l) => l.source === 'BCV');
      expect(bcvLine?.rate).toBe(75.0);
    });

    it('generates a complete WhatsApp quote message and copies to clipboard', async () => {
      const originalClipboard = navigator.clipboard;
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      const msg = component.usdVesWhatsAppMessage();
      expect(msg).toContain('COTIZACIÓN EXPRESS USD ⇄ VES');
      expect(msg).toContain('Atendido por: *Mesa P2P Caracas*');
      expect(msg).toContain('Tasa BCV Oficial');
      expect(msg).toContain('Tasa Binance P2P');

      await component.copyUsdVesQuote();
      expect(writeTextMock).toHaveBeenCalledWith(msg);
      expect(toastMock.success).toHaveBeenCalled();
      expect(component.usdVesCopied()).toBe(true);

      Object.assign(navigator, { clipboard: originalClipboard });
    });
  });

  describe('Multicurrency Corridors', () => {
    it('initializes with default corridor and calculates quote', () => {
      expect(component.corridors.length).toBeGreaterThan(0);
      const quote = component.quote();
      expect(quote.isValid).toBe(true);
      expect(quote.destPayoutAmount).toBeGreaterThan(0);
      expect(quote.operatorProfitDestFiat).toBeGreaterThan(0);
    });

    it('allows selecting a different corridor like VES_TO_USD_ZELLE', () => {
      component.selectCorridor('VES_TO_USD_ZELLE');
      expect(component.selectedCorridorId()).toBe('VES_TO_USD_ZELLE');
      expect(component.activeCorridor().originCurrency).toBe('VES');
      expect(component.activeCorridor().destCurrency).toBe('USD');

      const quote = component.quote();
      expect(quote.originCurrency).toBe('VES');
      expect(quote.destCurrency).toBe('USD');
      expect(quote.isValid).toBe(true);
    });

    it('generates corridor WhatsApp message and copies to clipboard', async () => {
      const originalClipboard = navigator.clipboard;
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      const msg = component.formattedMessage();
      expect(msg).toContain('COTIZACIÓN DE REMESA');

      await component.copyQuoteToClipboard();
      expect(writeTextMock).toHaveBeenCalledWith(msg);
      expect(toastMock.success).toHaveBeenCalled();
      expect(component.copied()).toBe(true);

      Object.assign(navigator, { clipboard: originalClipboard });
    });
  });
});
