import { describe, it, expect } from 'vitest';
import {
  normalizeBinanceApiOrders,
  parseBinanceCsvFills,
  correlateFillsToDecisions,
  calculateFillRealizedMetrics,
  type BinanceRawC2cOrder,
  type BinanceC2cFill,
} from './binance-fills';
import type { RepricerDecisionRecord, DecisionOutcome } from './decision-journal';

describe('Binance Fills & Ingestion Engine (T1/T2)', () => {
  describe('normalizeBinanceApiOrders', () => {
    it('normalizes valid API C2C order rows into typed BinanceC2cFill objects', () => {
      const rawOrders: BinanceRawC2cOrder[] = [
        {
          orderNumber: '202609280001',
          advNo: 'ADV-BUY-01',
          tradeType: 'BUY',
          asset: 'USDT',
          fiat: 'VES',
          amount: '150.00',
          totalPrice: '13275.00',
          unitPrice: '88.50',
          orderStatus: 'COMPLETED',
          createTime: 1774880000000,
          commission: '0.15',
          counterPartNickName: 'OperadorVzla',
        },
        {
          orderNumber: '202609280002',
          advNo: 'ADV-SELL-01',
          tradeType: 'SELL',
          asset: 'USDT',
          fiat: 'VES',
          amount: 200,
          totalPrice: 17900,
          unitPrice: 89.5,
          orderStatus: 'CANCELLED',
          createTime: 1774881000000,
          commission: 0,
        },
      ];

      const fills = normalizeBinanceApiOrders(rawOrders);
      expect(fills).toHaveLength(2);

      expect(fills[0]).toEqual({
        orderNumber: '202609280001',
        advNo: 'ADV-BUY-01',
        side: 'BUY',
        asset: 'USDT',
        fiat: 'VES',
        filledAmountUsdt: 150,
        filledPrice: 88.5,
        totalFiat: 13275,
        status: 'COMPLETED',
        createdAt: 1774880000000,
        commissionUsdt: 0.15,
        counterpartyNickname: 'OperadorVzla',
      });

      expect(fills[1].status).toBe('CANCELLED');
      expect(fills[1].side).toBe('SELL');
      expect(fills[1].filledAmountUsdt).toBe(200);
    });

    it('handles malformed numbers safely with fallback to 0', () => {
      const rawOrders: BinanceRawC2cOrder[] = [
        {
          orderNumber: '202609280003',
          advNo: '',
          tradeType: 'BUY',
          asset: 'USDT',
          fiat: 'VES',
          amount: 'invalid',
          totalPrice: 'not-a-number',
          unitPrice: 'NaN',
          orderStatus: 'PENDING',
          createTime: 1774882000000,
        },
      ];

      const fills = normalizeBinanceApiOrders(rawOrders);
      expect(fills[0].filledAmountUsdt).toBe(0);
      expect(fills[0].totalFiat).toBe(0);
      expect(fills[0].filledPrice).toBe(0);
      expect(fills[0].commissionUsdt).toBe(0);
    });
  });

  describe('parseBinanceCsvFills', () => {
    it('parses standard Binance P2P CSV with English headers', () => {
      const csv = `Order Number,Order Type,Asset Type,Fiat Type,Total Price,Unit Price,Quantity,Order Status,Created Time,Counterparty
202609280010,BUY,USDT,VES,"13,275.00",88.50,150.00,COMPLETED,2026-09-28 10:30:00,TraderOne
202609280011,SELL,USDT,VES,17900.00,89.50,200.00,COMPLETED,2026-09-28 11:00:00,TraderTwo`;

      const fills = parseBinanceCsvFills(csv);
      expect(fills).toHaveLength(2);
      expect(fills[0].orderNumber).toBe('202609280010');
      expect(fills[0].side).toBe('BUY');
      expect(fills[0].filledAmountUsdt).toBe(150);
      expect(fills[0].filledPrice).toBe(88.5);
      expect(fills[0].totalFiat).toBe(13275);
      expect(fills[0].status).toBe('COMPLETED');
      expect(fills[0].counterpartyNickname).toBe('TraderOne');
    });

    it('parses Binance P2P CSV with Spanish headers', () => {
      const csv = `Número de orden,Tipo de orden,Tipo de criptomoneda,Tipo de moneda fiat,Precio total,Precio unitario,Cantidad,Estado de la orden,Fecha de creación,Contraparte
202609280020,Compra,USDT,VES,8850.00,88.50,100.00,Completado,2026-09-28 12:00:00,CompradorXYZ`;

      const fills = parseBinanceCsvFills(csv);
      expect(fills).toHaveLength(1);
      expect(fills[0].orderNumber).toBe('202609280020');
      expect(fills[0].side).toBe('BUY');
      expect(fills[0].filledAmountUsdt).toBe(100);
      expect(fills[0].status).toBe('COMPLETED');
    });
  });

  describe('calculateFillRealizedMetrics', () => {
    it('calculates realized profit and spread percentage for a fill against modeled decision', () => {
      const fill: BinanceC2cFill = {
        orderNumber: '202609280001',
        advNo: 'ADV-BUY-01',
        side: 'BUY',
        asset: 'USDT',
        fiat: 'VES',
        filledAmountUsdt: 1000,
        filledPrice: 88.5,
        totalFiat: 88500,
        status: 'COMPLETED',
        createdAt: 1774880000000,
        commissionUsdt: 1.0,
      };

      const decision: Pick<RepricerDecisionRecord, 'modeledSpreadPct' | 'decisionPrice'> = {
        modeledSpreadPct: 1.2,
        decisionPrice: 88.5,
      };

      const metrics = calculateFillRealizedMetrics(fill, decision);
      // Modeled gross 1.2% on 1000 USDT = 12 USDT. Less 1 USDT commission = 11 USDT net profit.
      expect(metrics.realizedProfitUsdt).toBe(11);
      // Net spread = (11 / 1000) * 100 = 1.1%
      expect(metrics.realizedSpreadPct).toBe(1.1);
    });
  });

  describe('correlateFillsToDecisions', () => {
    const mockDecisionBuy: RepricerDecisionRecord = {
      id: 101,
      cycleId: 'CYCLE-2026-001',
      snapshotId: 1,
      side: 'BUY',
      decisionPrice: 88.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1.5,
      reason: 'Top maker bid',
      safetyFlags: [],
      createdAt: 1774879000000, // 1000s before fill
    };

    const mockDecisionSell: RepricerDecisionRecord = {
      id: 102,
      cycleId: 'CYCLE-2026-001',
      snapshotId: 2,
      side: 'SELL',
      decisionPrice: 89.8,
      origin: 'AUTO_ENGINE',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1.5,
      reason: 'Top maker ask',
      safetyFlags: [],
      createdAt: 1774879500000,
    };

    it('correlates completed fill to matching decision by side and time window', () => {
      const fills: BinanceC2cFill[] = [
        {
          orderNumber: 'FILL-1001',
          advNo: 'ADV-BUY-01',
          side: 'BUY',
          asset: 'USDT',
          fiat: 'VES',
          filledAmountUsdt: 500,
          filledPrice: 88.5,
          totalFiat: 44250,
          status: 'COMPLETED',
          createdAt: 1774880000000,
          commissionUsdt: 0.5,
          counterpartyNickname: 'PeerA',
        },
      ];

      const result = correlateFillsToDecisions({
        fills,
        decisions: [mockDecisionBuy, mockDecisionSell],
        existingOutcomes: [],
      });

      expect(result.outcomesToRecord).toHaveLength(1);
      expect(result.unmatchedFills).toHaveLength(0);
      expect(result.skippedExistingFills).toHaveLength(0);

      const outcome = result.outcomesToRecord[0];
      expect(outcome.decisionId).toBe(101);
      expect(outcome.source).toBe('BINANCE_MERCHANT');
      expect(outcome.success).toBe(true);
      expect(outcome.filledAmountUsdt).toBe(500);
      expect(outcome.filledPrice).toBe(88.5);
      expect(outcome.externalRef).toBe('FILL-1001');
      expect(outcome.realizedProfitUsdt).toBeGreaterThan(0);
      expect(outcome.realizedSpreadPct).toBeGreaterThan(0);
    });

    it('enforces strict idempotency: skips fills already recorded in existingOutcomes', () => {
      const fills: BinanceC2cFill[] = [
        {
          orderNumber: 'FILL-ALREADY-EXISTS',
          advNo: 'ADV-BUY-01',
          side: 'BUY',
          asset: 'USDT',
          fiat: 'VES',
          filledAmountUsdt: 200,
          filledPrice: 88.5,
          totalFiat: 17700,
          status: 'COMPLETED',
          createdAt: 1774880000000,
          commissionUsdt: 0.2,
        },
      ];

      const existingOutcome: Partial<DecisionOutcome> = {
        id: 50,
        decisionId: 101,
        externalRef: 'FILL-ALREADY-EXISTS',
        filledAmountUsdt: 200,
      };

      const result = correlateFillsToDecisions({
        fills,
        decisions: [mockDecisionBuy],
        existingOutcomes: [existingOutcome as DecisionOutcome],
      });

      expect(result.outcomesToRecord).toHaveLength(0);
      expect(result.skippedExistingFills).toEqual(['FILL-ALREADY-EXISTS']);
    });

    it('skips non-COMPLETED fills from recording outcomes', () => {
      const fills: BinanceC2cFill[] = [
        {
          orderNumber: 'FILL-CANCELLED',
          advNo: 'ADV-BUY-01',
          side: 'BUY',
          asset: 'USDT',
          fiat: 'VES',
          filledAmountUsdt: 100,
          filledPrice: 88.5,
          totalFiat: 8850,
          status: 'CANCELLED',
          createdAt: 1774880000000,
          commissionUsdt: 0,
        },
      ];

      const result = correlateFillsToDecisions({
        fills,
        decisions: [mockDecisionBuy],
        existingOutcomes: [],
      });

      expect(result.outcomesToRecord).toHaveLength(0);
      expect(result.unmatchedFills).toHaveLength(0);
    });

    it('handles fills when no matching decision is found by reporting them in unmatchedFills', () => {
      const fills: BinanceC2cFill[] = [
        {
          orderNumber: 'FILL-NO-DECISION',
          advNo: 'ADV-UNKNOWN',
          side: 'SELL',
          asset: 'USDT',
          fiat: 'VES',
          filledAmountUsdt: 100,
          filledPrice: 95.0,
          totalFiat: 9500,
          status: 'COMPLETED',
          createdAt: 1774880000000,
          commissionUsdt: 0,
        },
      ];

      const result = correlateFillsToDecisions({
        fills,
        decisions: [mockDecisionBuy], // Only BUY decision available, fill is SELL
        existingOutcomes: [],
      });

      expect(result.outcomesToRecord).toHaveLength(0);
      expect(result.unmatchedFills).toHaveLength(1);
      expect(result.unmatchedFills[0].orderNumber).toBe('FILL-NO-DECISION');
    });
  });
});
