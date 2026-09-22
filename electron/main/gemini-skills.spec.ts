import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  executeFinancialSkill,
  seedFinancialSkillMarketData,
  clearFinancialSkillMarketData,
  reportMeshThreat,
  getZkMeshStats,
  getFinancialSkillMarketData,
  GEMINI_FINANCIAL_SKILLS,
} from './gemini-skills';
import type { FinancialSkillResult } from './gemini-skills';

// ---------------------------------------------------------------------------
// Motores reales del dominio (origen único) usados como referencia cruzada.
// ---------------------------------------------------------------------------
import {
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
} from '../../projects/core/src/lib/triangular-arbitrage';
import {
  calculateBcvGap,
  getBcvMarketIntelligence,
} from '../../projects/core/src/lib/bcv-intervention-predictor';
import {
  calculatePortfolioDelta,
  evaluateDeltaHedge,
} from '../../projects/core/src/lib/delta-neutral-hedge';
import { predictTwoHourVolatility } from '../../projects/core/src/lib/volatility-forecaster';
import { simulateTradeImpact } from '../../projects/core/src/lib/trade-impact-simulator';
import { evaluateFraudRisk } from '../../projects/core/src/lib/fraud-shield';
import type { BinanceOfferSummary } from '../../projects/core/src/lib/binance-p2p';

const VENDORED_CORE_FILES = [
  'money',
  'log',
  'operator-manager',
  'accounts',
  'johnson-depth',
  'orderbook-microstructure',
  'binance-p2p',
  'backup-encryption',
  'triangular-arbitrage',
  'bcv-intervention-predictor',
  'delta-neutral-hedge',
  'volatility-forecaster',
  'zk-market-mesh',
  'fsm',
  'receipt-ocr',
  'fraud-shield',
  'dispute-copilot',
  'trade-impact-simulator',
  'spread-quality',
  'counterparty',
  'binance-earn-vault',
  'operations-workflow',
  'webhooks',
  'audit-analytics',
];

function mkOffer(
  price: number,
  maxVes: number,
  advNo: string,
  merchantName = 'Mercante Test',
): BinanceOfferSummary {
  return {
    advNo,
    price,
    merchantName,
    finishRatePct: 97,
    orderCount: 120,
    minVes: 1000,
    maxVes,
    payMethods: ['Pago Móvil'],
  };
}

function dataOf(r: FinancialSkillResult): Record<string, unknown> {
  expect(r.success).toBe(true);
  return (r.data ?? {}) as Record<string, unknown>;
}

describe('gemini-skills: motores reales de @p2p/core (WU 2.1 Fase 2)', () => {
  beforeEach(() => {
    clearFinancialSkillMarketData();
  });

  it('registro público intacto: 44 skills y firma de dispatcher estable', () => {
    expect(GEMINI_FINANCIAL_SKILLS.length).toBe(44);
    expect(executeFinancialSkill).toBeTypeOf('function');
  });

  it('skill desconocido responde error controlado', () => {
    const r = executeFinancialSkill('no_existe', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('no reconocida');
  });

  it('evaluate_golden_spread aplica la Regla de Oro institucional (0.50%)', () => {
    const viable = dataOf(executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 0.6 }));
    expect(viable['isGolden']).toBe(true);
    expect(viable['verdict']).toBe('VIABLE_INSTITUCIONAL');
    expect(viable['thresholdPct']).toBe(0.5);

    const subOptimal = dataOf(
      executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 0.4 }),
    );
    expect(subOptimal['isGolden']).toBe(false);
    expect(subOptimal['verdict']).toBe('SUB_OPTIMAL');
  });

  it('predict_bcv_market_intelligence usa getBcvMarketIntelligence real', () => {
    const d = dataOf(
      executeFinancialSkill('predict_bcv_market_intelligence', {
        parallelRate: 100,
        bcvRate: 60,
      }),
    );
    const g = d['gap'] as { gapPct: number; zone: string };
    const expected = getBcvMarketIntelligence(100, 60);
    expect(g.gapPct).toBe(calculateBcvGap(100, 60).gapPct);
    expect(g.zone).toBe('CRITICAL_DISPERSION'); // >35% => determinístico
    expect((d['recommendation'] as { action: string }).action).toBe(expected.recommendation.action);
    expect((d['recommendation'] as { action: string }).action).toBe('DEFENSIVE_HEDGE');
    expect(d['window']).toBeDefined();
    expect(d['timestamp']).toBeTypeOf('string');
  });

  it('evaluate_delta_neutral_hedge usa calculatePortfolioDelta + evaluateDeltaHedge', () => {
    const snapshot = {
      vesBalance: 500000,
      usdtBalance: 1000,
      currentParallelRate: 85,
      vesMaxHoldingTimeMinutes: 60,
      openP2pSellOrdersUsdt: 0,
      openP2pBuyOrdersVes: 0,
    };
    const d = dataOf(executeFinancialSkill('evaluate_delta_neutral_hedge', snapshot));
    const delta = calculatePortfolioDelta(snapshot);
    const proposal = evaluateDeltaHedge(snapshot);

    expect(d['fiatExposureUsd']).toBe(delta.fiatExposureUsd);
    expect(d['netDeltaRatio']).toBe(delta.netDeltaRatio);
    expect(d['unhedgedVesRiskScore']).toBe(delta.unhedgedVesRiskScore);
    expect(d['urgency']).toBe(delta.urgency);

    const proposals = d['proposals'] as Record<string, unknown>[];
    expect(proposals.length).toBe(1);
    expect(proposals[0]['hedgeAmountUsdt']).toBe(proposal?.hedgeAmountUsdt ?? -1);
    expect(proposals[0]['action']).toBe(proposal?.action);
    expect(proposals[0]['requiresHumanSignature']).toBe(true);
  });

  it('evaluate_delta_neutral_hedge no propone cobertura cuando el delta es seguro', () => {
    const safe = {
      vesBalance: 1000,
      usdtBalance: 10000,
      currentParallelRate: 85,
      vesMaxHoldingTimeMinutes: 0,
    };
    const d = dataOf(executeFinancialSkill('evaluate_delta_neutral_hedge', safe));
    expect(d['proposals']).toEqual([]);
    expect(d['urgency']).toBe('NONE');
  });

  it('audit_zk_mesh_threat consulta la malla ZK: hash coincidente => FLAGGED', () => {
    reportMeshThreat({
      rawIdentifier: 'V-12.345.678',
      threatType: 'THIRD_PARTY_FRAUD',
      severity: 'CRITICAL',
      sanitizedSummary: 'Prueba determinista del mesh federado.',
    });
    expect(getZkMeshStats().threatCount).toBeGreaterThanOrEqual(1);

    const d = dataOf(executeFinancialSkill('audit_zk_mesh_threat', { identifier: 'v12345678' }));
    expect(d['threatFound']).toBe(true);
    expect(d['riskStatus']).toBe('FLAGGED');
    expect(d['identifierLength']).toBe(9);
    const threats = d['threats'] as { severity: string; threatType: string }[];
    expect(threats[0].severity).toBe('CRITICAL');
    expect(threats[0].threatType).toBe('THIRD_PARTY_FRAUD');
    expect(d['confidenceScore'] as number).toBeGreaterThan(0);
    expect(d['blindHash']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('audit_zk_mesh_threat devuelve CLEAN solo cuando el mesh no reporta la identidad', () => {
    const r = executeFinancialSkill('audit_zk_mesh_threat', { identifier: 'C99999999' });
    expect(r.success).toBe(true);
    const d = dataOf(r);
    expect(d['threatFound']).toBe(false);
    expect(d['riskStatus']).toBe('CLEAN');
    expect(d['threats']).toEqual([]);
  });

  it('scan_triangular_arbitrage ejecuta calculateTriangularArbitrage (sin hardcode 1.35)', () => {
    const route = DEFAULT_TRIANGULAR_PRESETS.find((p) => p.initialCurrency === 'USDT');
    expect(route).toBeDefined();
    const d = dataOf(
      executeFinancialSkill('scan_triangular_arbitrage', {
        initialAmount: 1000,
        initialCurrency: 'USDT',
      }),
    );
    const expected = calculateTriangularArbitrage(route!.id, route!.name, 1000, route!.legs);

    expect(d['netSpreadPct']).toBe(expected.roiPct);
    expect(d['profitInitialCurrency']).toBe(expected.netProfit);
    expect(d['isProfitable']).toBe(expected.isProfitable);
    expect(d['roiPct']).not.toBe(1.35); // el hardcode 1.35 fue eliminado
    expect(d['riskLevel'] as string).toBe(expected.riskLevel);
    expect(String(d['engine'])).toContain('triangular-arbitrage');
  });

  it('scan_triangular_arbitrage inyecta precios del libro P2P en vivo cuando existe', () => {
    seedFinancialSkillMarketData({
      buyOffers: [mkOffer(86.0, 100000, 'adv-b1')],
      sellOffers: [mkOffer(89.0, 100000, 'adv-s1')],
    });
    expect(getFinancialSkillMarketData().available).toBe(true);
    expect(getFinancialSkillMarketData().bestBuyPrice).toBe(86.0);

    const d = dataOf(
      executeFinancialSkill('scan_triangular_arbitrage', {
        initialAmount: 1000,
        initialCurrency: 'USDT',
      }),
    );
    const steps = d['steps'] as { toCurrency: string; price: number }[];
    const vesToUsdt = steps.find((s) => s.toCurrency === 'USDT');
    expect(vesToUsdt?.price).toBe(86.0); // pierna VES->USDT usa bestBuyPrice real
    expect(d['liveMarketUsed']).toBe(true);
  });

  it('simulate_trade_impact usa el libro real: bestQuotedPrice del libro, nunca 88.5', () => {
    seedFinancialSkillMarketData({
      buyOffers: [mkOffer(86.2, 95000, 'adv-buy-1'), mkOffer(86.9, 60000, 'adv-buy-2')],
      sellOffers: [mkOffer(89.4, 80000, 'adv-sel-1')],
    });
    const d = dataOf(
      executeFinancialSkill('simulate_trade_impact', { targetAmountUsdt: 500, side: 'BUY' }),
    );
    expect(d['bestQuotedPrice']).toBe(86.2);
    expect(d['bestQuotedPrice']).not.toBe(88.5);
    expect(d['isFullyFillable']).toBe(true);
    expect(d['effectiveVwapPrice'] as number).toBeGreaterThan(0);
    expect(d['marketDataSource']).toBe('LIVE_BINANCE_P2P_CACHE');

    // Cruce con el motor real
    const expected = simulateTradeImpact({
      targetAmountUsdt: 500,
      side: 'BUY',
      availableOffers: [mkOffer(86.2, 95000, 'adv-buy-1'), mkOffer(86.9, 60000, 'adv-buy-2')],
    });
    expect(d['slippageBps']).toBe(expected.slippageBps);
    expect(d['overallFillProbabilityPct']).toBe(expected.overallFillProbabilityPct);
  });

  it('simulate_trade_impact con libro vacío: fallback honesto sin precio inventado', () => {
    const d = dataOf(
      executeFinancialSkill('simulate_trade_impact', { targetAmountUsdt: 500, side: 'BUY' }),
    );
    expect(d['marketDataSource']).toBe('EMPTY_BOOK_FALLBACK');
    expect(d['bestQuotedPrice']).toBe(0);
    expect(d['isFullyFillable']).toBe(false);
    expect(String(d['warning'])).toContain('Sin libro');
  });

  it('generate_dispute_dossier corre evaluateFraudRisk + buildDisputeDossier (pago de tercero)', () => {
    const r = executeFinancialSkill('generate_dispute_dossier', {
      orderId: '8899001122',
      orderAmountFiat: 42500,
      orderAmountCrypto: 500,
      counterpartyBinanceName: 'CARLOS PEREZ',
      bankPayerName: 'ROSA LOPEZ GOMEZ',
      bankName: 'Banesco',
      bankReference: 'ASDFGHJK123',
    });
    expect(r.success).toBe(true);
    const d = dataOf(r);

    expect(String(d['caseId'])).toMatch(/^DSP-/);
    expect(d['severity']).toBe('CRITICAL');
    expect(String(d['primaryReason'])).toContain('tercero');
    expect(String(d['appealTextEn']).toLowerCase()).toContain('third-party');

    const forensics = d['forensics'] as {
      overallScore: number;
      riskLevel: string;
      flags: string[];
      nameSimilarityPct: number;
    };
    expect(forensics.flags).toContain('THIRD_PARTY_PAYER');
    expect(forensics.riskLevel).toBe('CRITICAL');

    // Cruce con el motor real
    const audit = evaluateFraudRisk({
      orderId: '8899001122',
      orderAmount: 42500,
      orderCurrency: 'VES',
      advertiserVerifiedName: 'CARLOS PEREZ',
      receipt: {
        reference: 'ASDFGHJK123',
        amount: 42500,
        currency: 'VES',
        payerName: 'ROSA LOPEZ GOMEZ',
        bank: 'BANESCO',
        timestamp: new Date().toISOString(),
      },
      blacklistedReferences: [],
    });
    expect(forensics.overallScore).toBe(audit.overallScore);
    expect(forensics.nameSimilarityPct).toBe(Math.round(audit.nameMatch.score * 100));
  });

  it('forecast_market_volatility_2h usa predictTwoHourVolatility real', () => {
    const d = dataOf(
      executeFinancialSkill('forecast_market_volatility_2h', {
        currentSpreadPct: 1.45,
        parallelRate: 90.5,
        bcvRate: 72.0,
      }),
    );
    expect(d['forecastWindowHours']).toBe(2);
    expect(d['volatilityIndex']).toBeGreaterThanOrEqual(5);
    expect(d['volatilityIndex']).toBeLessThanOrEqual(100);
    const sources = d['sources'] as {
      bcvGap?: { gapPct: number; zone: string };
      bcvWindow: { phase: string; probabilityPct: number };
      bidDepthUsdt?: number;
      askDepthUsdt?: number;
    };

    const expected = predictTwoHourVolatility({
      recentTicks: [],
      currentSpreadPct: 1.45,
      bcvGap: sources.bcvGap,
      bcvWindow: sources.bcvWindow,
      bidDepthUsdt: sources.bidDepthUsdt,
      askDepthUsdt: sources.askDepthUsdt,
    });
    expect(d['volatilityIndex']).toBe(expected.volatilityIndex);
    expect(d['level']).toBe(expected.level);
    expect(d['direction']).toBe(expected.direction);
    expect(d['expectedSpreadDriftBps']).toBe(expected.expectedSpreadDriftBps);
    expect((d['suggestedSpreadAdjustmentPct'] as { buyMarkupPct: number }).buyMarkupPct).toBe(
      expected.suggestedSpreadAdjustmentPct.buyMarkupPct,
    );
  });

  it('ejecuta optimize_idle_capital_simple_earn y calculate_earn_yield_vs_p2p_hurdle_rate en Electron', () => {
    const earnRes = dataOf(
      executeFinancialSkill('optimize_idle_capital_simple_earn', {
        capitalUsdt: 4000,
        tier1LimitUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.5,
      }),
    );
    expect(earnRes['tier1Allocated']).toBe(500);
    expect(earnRes['tier2Allocated']).toBe(3500);
    expect(earnRes['effectiveBlendedAprPct']).toBeGreaterThan(2.5);

    const hurdleRes = dataOf(
      executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
        grossP2pSpreadPct: 1.6,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: 2,
        simpleEarnAprPct: 4.0,
      }),
    );
    expect(hurdleRes['verdict']).toBe('OPERATE_P2P');
    expect(hurdleRes['isP2pProfitableOverEarn']).toBe(true);
  });

  it('ejecuta habilidades operativas y gobernanza SOP con precisión determinista', () => {
    const leadRes = dataOf(
      executeFinancialSkill('qualify_direct_lead_and_close', {
        leadChannel: 'WHATSAPP',
        estimatedWeeklyVolumeUsdt: 6000,
        paymentMethodPreferred: 'Banesco',
        isKycVerified: true,
        primaryConcern: 'SPEED',
        currentParallelRate: 85.0,
      }),
    );
    expect(leadRes['leadTier']).toBe('VIP_COMMERCIAL');
    expect(leadRes['actionProtocol']).toBe('ONBOARD_IMMEDIATELY');

    const triageRes = dataOf(
      executeFinancialSkill('triage_incident_and_escalate', {
        incidentType: 'BANK_ACCOUNT_HOLD',
        amountAtRiskUsdt: 5000,
        orderId: 'ORD-CRISIS-100',
      }),
    );
    expect(triageRes['severityLevel']).toBe('P1_CRITICAL');
    expect(triageRes['requiresHumanHandoff']).toBe(true);

    const sopRes = dataOf(
      executeFinancialSkill('audit_sop_compliance_enforcement', {
        orderId: 'ORD-SOP-1',
        accountHolderMatchesDocument: true,
        bankBalanceConfirmedInAvailableFunds: true,
        responseTimeMinutes: 3,
        fundsReleasedBeforeBankVerification: false,
      }),
    );
    expect(sopRes['isCompliant']).toBe(true);
    expect(sopRes['complianceScore']).toBe(100);

    const sheetRes = dataOf(
      executeFinancialSkill('sync_google_sheets_live_ledger', {
        tradeDate: '2026-09-18',
        orderId: 'ORD-GSHEET-1',
        counterpartyAlias: 'VipBuyer',
        tradeType: 'SELL',
        cryptoAmountUsdt: 1000,
        fiatAmountVes: 85000,
        exchangeRate: 85.0,
        platformFeeUsdt: 1.0,
        bankTransferFeeVes: 25.0,
      }),
    );
    expect(sheetRes['rowValues']).toBeDefined();
    expect(sheetRes['calculatedGrossProfitUsdt']).toBeGreaterThan(0);
  });

  it('audit_and_risk_analytics formula dictamen forense y detecta distribución horaria y disciplina', () => {
    const res = dataOf(
      executeFinancialSkill('audit_and_risk_analytics', {
        timeframeDays: 7,
        minSpreadThresholdPct: 0.5,
        sampleEvents: [
          { timestamp: '2026-09-19T11:00:00Z', severity: 'error', action: 'SECURITY_ALERT' },
        ],
        sampleOperations: [
          { timestamp: '2026-09-19T10:00:00Z', netSpreadPct: 1.25, cryptoAmount: 1000 },
        ],
      }),
    );
    expect(res['timeframeDays']).toBe(7);
    const dossier = res['dossier'] as Record<string, unknown>;
    expect(dossier).toBeDefined();
    expect(dossier['operatorStanding']).toBe('DISCIPLINED');
    expect(dossier['goldenRuleComplianceScore']).toBe(100);
  });

  it('integridad: los motores embebidos son byte-idénticos a projects/core/src/lib', () => {
    const vendorDir = join(process.cwd(), 'main', 'vendor', 'p2p-core');
    const libDir = join(process.cwd(), '..', 'projects', 'core', 'src', 'lib');
    for (const name of VENDORED_CORE_FILES) {
      expect(readFileSync(join(vendorDir, `${name}.ts`), 'utf8'), name).toBe(
        readFileSync(join(libDir, `${name}.ts`), 'utf8'),
      );
    }
  });
});
