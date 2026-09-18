import { describe, it, expect, beforeEach } from 'vitest';
import {
  OrderPersistenceTracker,
  sanitizeOffers,
  computeMicrostructureSanitizedDepth,
} from './orderbook-microstructure';
import { type BinanceOfferSummary } from './binance-p2p';

describe('Orderbook Microstructure: Detección de Spoofing & Liquidez Fantasma', () => {
  let tracker: OrderPersistenceTracker;

  const mockBaseOffers: BinanceOfferSummary[] = [
    {
      advNo: 'ADV-LEGIT-1',
      merchantName: 'CambiosCaracas_Oficial',
      price: 800.0,
      minVes: 1000,
      maxVes: 80000,
      finishRatePct: 99.5,
      orderCount: 1500,
      payMethods: ['Banesco', 'Pago Móvil'],
    },
    {
      advNo: 'ADV-LEGIT-2',
      merchantName: 'Inversiones_ElAvila',
      price: 802.0,
      minVes: 500,
      maxVes: 60000,
      finishRatePct: 98.2,
      orderCount: 890,
      payMethods: ['Banesco'],
    },
  ];

  beforeEach(() => {
    tracker = new OrderPersistenceTracker(15);
  });

  describe('OrderPersistenceTracker', () => {
    it('debe registrar órdenes nuevas y calcular su persistencia conforme pasan los snapshots', () => {
      const t0 = 1700000000000;
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t0);

      const t1 = t0 + 120 * 1000; // 2 minutos después
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1);

      const report = tracker.generateSpoofReport(t1);
      expect(report.totalTracked).toBe(2);
      expect(report.legitimateCount).toBe(2);
      expect(report.spoofBaitCount).toBe(0);
      expect(report.classifiedOrders[0].category).toBe('LEGITIMATE');
    });

    it('debe detectar un anuncio cebo (SPOOF_BAIT) retirado en menos de 75 segundos con precio agresivo', () => {
      const t0 = 1700000000000;
      const baitAd: BinanceOfferSummary = {
        advNo: 'ADV-BAIT-SPOOF',
        merchantName: 'Trader_FastCancel',
        price: 790.0, // Precio cebo irreal para bajar el mercado
        minVes: 10000,
        maxVes: 200000,
        finishRatePct: 75.0, // Tasa de completitud sospechosa
        orderCount: 20,
        payMethods: ['Banesco'],
      };

      tracker.ingestSnapshot([...mockBaseOffers, baitAd], 'SELL', t0);

      // A los 45 segundos, el anuncio desaparece del libro
      const t1 = t0 + 45 * 1000;
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1);

      const report = tracker.generateSpoofReport(t1);
      expect(report.spoofBaitCount).toBe(1);

      const baitClassification = report.classifiedOrders.find((c) => c.advNo === 'ADV-BAIT-SPOOF');
      expect(baitClassification).toBeDefined();
      expect(baitClassification?.category).toBe('SPOOF_BAIT');
      expect(baitClassification?.confidencePct).toBeGreaterThanOrEqual(80);
    });

    it('debe detectar liquidez fantasma (PHANTOM_LIQUIDITY) con volumen desproporcionado que desaparece sin trades', () => {
      const t0 = 1700000000000;
      const phantomAd: BinanceOfferSummary = {
        advNo: 'ADV-PHANTOM-WALL',
        merchantName: 'FakeWhale_Bot',
        price: 801.0,
        minVes: 50000,
        maxVes: 950000, // Volumen descomunal (más de 10x el promedio)
        finishRatePct: 92.0,
        orderCount: 150,
        payMethods: ['Banesco'],
      };

      tracker.ingestSnapshot([...mockBaseOffers, phantomAd], 'SELL', t0);

      // Desaparece a los 90 segundos sin haber ejecutado operaciones
      const t1 = t0 + 90 * 1000;
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1);

      const report = tracker.generateSpoofReport(t1);
      expect(report.phantomLiquidityCount).toBe(1);
      expect(report.phantomLiquidityVes).toBe(950000);

      const phantomClassification = report.classifiedOrders.find((c) => c.advNo === 'ADV-PHANTOM-WALL');
      expect(phantomClassification?.category).toBe('PHANTOM_LIQUIDITY');
    });
  });

  describe('Sanitización de Profundidad Johnson', () => {
    it('debe purgar las órdenes tóxicas de la lista antes del cálculo de precio ponderado', () => {
      const t0 = 1700000000000;
      const baitAd: BinanceOfferSummary = {
        advNo: 'ADV-BAIT-SPOOF',
        merchantName: 'Trader_FastCancel',
        price: 790.0,
        minVes: 1000,
        maxVes: 50000,
        finishRatePct: 70.0,
        orderCount: 15,
        payMethods: ['Banesco'],
      };

      const offers = [...mockBaseOffers, baitAd];
      tracker.ingestSnapshot(offers, 'SELL', t0);

      const t1 = t0 + 30 * 1000;
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1); // baitAd desapareció

      const report = tracker.generateSpoofReport(t1);
      const cleanOffers = sanitizeOffers(offers, report);

      expect(cleanOffers.length).toBe(2);
      expect(cleanOffers.find((o) => o.advNo === 'ADV-BAIT-SPOOF')).toBeUndefined();
    });

    it('computeMicrostructureSanitizedDepth debe arrojar métricas reales y detectar manipulación', () => {
      const t0 = 1700000000000;
      const baitAd: BinanceOfferSummary = {
        advNo: 'ADV-BAIT-SPOOF',
        merchantName: 'Manipulador',
        price: 790.0,
        minVes: 1000,
        maxVes: 100000,
        finishRatePct: 60.0,
        orderCount: 5,
        payMethods: ['Banesco'],
      };

      const offers = [...mockBaseOffers, baitAd];
      tracker.ingestSnapshot(offers, 'SELL', t0);

      const t1 = t0 + 40 * 1000;
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1);

      const depthResult = computeMicrostructureSanitizedDepth(offers, 'SELL', 100, tracker, t1);

      expect(depthResult.manipulationDetected).toBe(true);
      expect(depthResult.purgedSpoofCount).toBe(1);
      expect(depthResult.sanitizedOffersCount).toBe(2);
      // El precio real no debe estar distorsionado por los 790 del spoofing
      expect(depthResult.sanitizedPrice).toBeGreaterThanOrEqual(800.0);
    });

    it('debe clasificar orden como SUSPICIOUS_HIGH_TURNOVER si desaparece antes de 180s', () => {
      const t0 = 1700000000000;
      const volatileAd: BinanceOfferSummary = {
        advNo: 'ADV-VOLATILE-1',
        merchantName: 'TraderInestable',
        price: 801.0,
        minVes: 1000,
        maxVes: 50000,
        finishRatePct: 95.0,
        orderCount: 100,
        payMethods: ['Banesco'],
      };

      tracker.ingestSnapshot([...mockBaseOffers, volatileAd], 'SELL', t0);
      const t1 = t0 + 130 * 1000; // Desaparece a los 130s (< 180s)
      tracker.ingestSnapshot(mockBaseOffers, 'SELL', t1);

      const report = tracker.generateSpoofReport(t1);
      const volatile = report.classifiedOrders.find((o) => o.advNo === 'ADV-VOLATILE-1');
      expect(volatile?.category).toBe('SUSPICIOUS_HIGH_TURNOVER');
    });

    it('debe generar un reporte vacío sin errores si no hay órdenes en seguimiento', () => {
      const emptyTracker = new OrderPersistenceTracker(10);
      const report = emptyTracker.generateSpoofReport();
      expect(report.totalTracked).toBe(0);
      expect(report.manipulationRiskScore).toBe(0);
      expect(report.classifiedOrders.length).toBe(0);
    });
  });

  describe('Phase 1: Modelos Cuantitativos de Microestructura y Market Making', () => {
    it('Avellaneda-Stoikov: calcula el precio de reserva con skew de inventario positivo (vender excedente)', async () => {
      const { computeAvellanedaStoikovQuotes } = await import('./orderbook-microstructure');
      const res = computeAvellanedaStoikovQuotes({
        midPrice: 85.0,
        currentInventoryUsdt: 8000,
        targetInventoryUsdt: 5000, // Exceso de 3000 USDT (+60%)
        volatilityDaily: 0.02,
        timeRemainingFraction: 1.0,
        riskAversionGamma: 0.1,
      });

      expect(res.inventorySkewUsdt).toBe(3000);
      expect(res.reservationPrice).toBeLessThan(85.0); // Con exceso de USDT, baja el precio de reserva para incentivar ventas
      expect(res.optimalBidPrice).toBeLessThan(res.reservationPrice);
      expect(res.optimalAskPrice).toBeGreaterThan(res.reservationPrice);
      expect(res.recommendedAction).toBe('SKEW_SELL');
    });

    it('VPIN: detecta toxicidad extrema y calcula multiplicador de spread defensivo', async () => {
      const { calculateVpinMetric } = await import('./orderbook-microstructure');
      // 5 buckets fuertemente desbalanceados (todos compras agresivas de informados)
      const buckets = [
        { buyVolume: 9000, sellVolume: 1000, totalVolume: 10000 },
        { buyVolume: 8500, sellVolume: 1500, totalVolume: 10000 },
        { buyVolume: 9200, sellVolume: 800, totalVolume: 10000 },
        { buyVolume: 8800, sellVolume: 1200, totalVolume: 10000 },
      ];

      const res = calculateVpinMetric({ buckets, toxicityThreshold: 0.25 });
      expect(res.vpinScore).toBeGreaterThan(0.45);
      expect(res.toxicityClassification).toBe('EXTREME_ADVERSE_SELECTION');
      expect(res.recommendedProtectiveSpreadMultiplier).toBeGreaterThanOrEqual(2.0);
      expect(res.warningNotice).toBeDefined();
    });

    it('TWAP/VWAP Slicing: fragmenta un ticket institucional de 10,000 USDT en bloques seguros', async () => {
      const { computeOrderSlicingPlan } = await import('./orderbook-microstructure');
      const res = computeOrderSlicingPlan({
        totalAmountUsdt: 10000,
        executionDurationMinutes: 60,
        estimatedMarketVolumePerHourUsdt: 80000,
        currentMidPrice: 85.0,
        algorithm: 'TWAP',
      });

      expect(res.totalSlices).toBeGreaterThanOrEqual(4);
      expect(res.slices.length).toBe(res.totalSlices);
      const totalSlicesUsdt = res.slices.reduce((acc, s) => acc + s.sliceAmountUsdt, 0);
      expect(Math.round(totalSlicesUsdt)).toBe(10000);
      expect(res.expectedMarketImpactPct).toBeLessThan(1.0);
    });

    it('Markov Fill Probability: calcula alta probabilidad de llenado para orden en la punta', async () => {
      const { calculateMakerFillProbabilityMarkov } = await import('./orderbook-microstructure');
      const res = calculateMakerFillProbabilityMarkov({
        queuePositionIndex: 0,
        queueAheadVolumeUsdt: 500,
        recentFillVelocityPerMinuteUsdt: 200,
        orderCancellationRatePct: 20,
        targetHorizonMinutes: 15,
      });

      expect(res.queuePosition).toBe(1);
      expect(res.urgencyState).toBe('INSTANT_FILL_PROBABLE');
      expect(res.fillProbabilityInHorizonPct).toBeGreaterThan(80);
      expect(res.recommendedPricingAdjustment).toBe(0);
    });
  });
});

