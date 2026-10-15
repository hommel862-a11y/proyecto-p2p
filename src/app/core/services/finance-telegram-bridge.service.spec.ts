import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinanceTelegramBridgeService } from './finance-telegram-bridge.service';
import type { Finance360Service } from '../finance-360.service';
import type { TelegramWorkerService } from '../telegram-worker.service';

describe('FinanceTelegramBridgeService', () => {
  let service: FinanceTelegramBridgeService;
  let mockFinance: any;
  let mockTelegram: any;

  beforeEach(() => {
    mockFinance = {
      currentBcvRate: vi.fn().mockReturnValue(60),
      currentParallelRate: vi.fn().mockReturnValue(65),
      addExpense: vi.fn(),
      addIncome: vi.fn(),
      calculateCasheaBreakdown: vi.fn().mockReturnValue({
        initialPercentage: 0.4,
        initialPaymentUsd: 60,
        installmentAmountUsd: 30,
        installments: [],
      }),
      registerCasheaPlan: vi.fn().mockReturnValue({
        id: 'plan-1',
        productName: 'Taladro',
        numberOfInstallments: 3,
      }),
      netWorthUsd: vi.fn().mockReturnValue(5000),
      netWorthVes: vi.fn().mockReturnValue(300000),
      totalAssetsUsd: vi.fn().mockReturnValue(6000),
      totalLiabilitiesUsd: vi.fn().mockReturnValue(1000),
      liquidityHealthStatus: vi.fn().mockReturnValue({ status: 'optimal', label: 'Salud Óptima' }),
      upcomingLiabilities7Days: vi.fn().mockReturnValue([]),
    };

    mockTelegram = {
      sendTelegramMessage: vi.fn().mockResolvedValue(true),
    };

    service = new FinanceTelegramBridgeService(mockFinance, mockTelegram);
  });

  it('should parse and register #gasto correctly', () => {
    const res = service.processInboundTelegramCommand('#gasto 20 USD Gasolina para el taller pyme');
    expect(res.success).toBe(true);
    expect(res.action).toBe('expense');
    expect(mockFinance.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Gasolina para el taller',
        scope: 'business',
        category: 'transport',
      }),
    );
  });

  it('should parse and register #ingreso correctly', () => {
    const res = service.processInboundTelegramCommand('#ingreso 120 USD Cobro de presupuesto pyme');
    expect(res.success).toBe(true);
    expect(res.action).toBe('income');
    expect(mockFinance.addIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cobro de presupuesto',
        scope: 'business',
        category: 'business_sale',
      }),
    );
  });

  it('should parse and calculate #cashea breakdown correctly', () => {
    const res = service.processInboundTelegramCommand('#cashea 150 3 Nevera Mabe');
    expect(res.success).toBe(true);
    expect(res.action).toBe('cashea');
    expect(mockFinance.registerCasheaPlan).toHaveBeenCalled();
  });

  it('should return financial summary report on #resumen', () => {
    const res = service.processInboundTelegramCommand('#resumen');
    expect(res.success).toBe(true);
    expect(res.action).toBe('summary');
    expect(res.replyText).toContain('RESUMEN EJECUTIVO FINANZAS 360');
    expect(res.replyText).toContain('$5000.00 USD');
  });

  it('should dispatch daily briefing to Telegram when credentials provided', async () => {
    const success = await service.sendDailyBriefingToTelegram('token-123', 'chat-456');
    expect(success).toBe(true);
    expect(mockTelegram.sendTelegramMessage).toHaveBeenCalledWith(
      'token-123',
      'chat-456',
      expect.stringContaining('RESUMEN EJECUTIVO FINANZAS 360'),
    );
  });

  it('should return false if credentials missing when dispatching briefing', async () => {
    const success = await service.sendDailyBriefingToTelegram();
    expect(success).toBe(false);
  });
});
