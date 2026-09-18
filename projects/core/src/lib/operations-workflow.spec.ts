import { describe, it, expect } from 'vitest';
import {
  qualifyDirectLeadAndClose,
  generateSocialTrafficFunnel,
  benchmarkCompetitorMarketIntelligence,
  orchestrateWorkspaceSync,
  executeDesktopRpaReconciliation,
  monitorServiceHealthAndFallback,
  triageIncidentAndEscalate,
  auditSopComplianceEnforcement,
  syncGoogleSheetsLiveLedger,
  forecastCashFlowAndReconciliation,
} from './operations-workflow';

describe('Operations Workflow, CRM, SOP Governance & Ledger Suite', () => {
  describe('qualifyDirectLeadAndClose', () => {
    it('qualifies high-volume KYC-verified lead as VIP_COMMERCIAL with tighter margin', () => {
      const result = qualifyDirectLeadAndClose({
        leadChannel: 'WHATSAPP',
        estimatedWeeklyVolumeUsdt: 8000,
        paymentMethodPreferred: 'Banesco Pago Móvil',
        isKycVerified: true,
        primaryConcern: 'PRICE',
        currentParallelRate: 85.0,
      });

      expect(result.qualificationScore).toBeGreaterThanOrEqual(80);
      expect(result.leadTier).toBe('VIP_COMMERCIAL');
      expect(result.actionProtocol).toBe('ONBOARD_IMMEDIATELY');
      expect(result.recommendedNetMarginBps).toBe(75);
      expect(result.quotedRate).toBeGreaterThan(85.0);
    });

    it('flags unverified lead as HIGH_RISK_SUSPECT or requests verification', () => {
      const result = qualifyDirectLeadAndClose({
        leadChannel: 'TELEGRAM',
        estimatedWeeklyVolumeUsdt: 200,
        paymentMethodPreferred: 'Efectivo USD',
        isKycVerified: false,
        primaryConcern: 'SECURITY',
        currentParallelRate: 85.0,
      });

      expect(result.leadTier).toBe('HIGH_RISK_SUSPECT');
      expect(result.actionProtocol).toBe('DECLINE_HIGH_RISK');
    });
  });

  describe('generateSocialTrafficFunnel', () => {
    it('generates hook and educational script for inflation hedge', () => {
      const result = generateSocialTrafficFunnel({
        targetAudience: 'MERCHANT_IMPORTERS',
        platform: 'INSTAGRAM',
        currentBcvGapPct: 24.5,
        educationalTheme: 'INFLATION_HEDGE',
      });

      expect(result.hookHeadline).toContain('retener bolívares');
      expect(result.educationalBody).toContain('24.5%');
      expect(result.callToActionCta).toContain('PROTECCIÓN');
      expect(result.targetConversionRatePct).toBeGreaterThan(2.0);
    });
  });

  describe('benchmarkCompetitorMarketIntelligence', () => {
    it('computes rank, median price and detects underserved payment methods', () => {
      const result = benchmarkCompetitorMarketIntelligence({
        ourCurrentPrice: 85.5,
        targetSide: 'SELL',
        ourMinMarginPct: 0.8,
        competitorOffers: [
          { operatorName: 'Trader 1', price: 85.0, completionRatePct: 98, totalOrdersCount: 500, paymentMethods: ['Banesco', 'Pago Móvil'] },
          { operatorName: 'Trader 2', price: 85.2, completionRatePct: 95, totalOrdersCount: 200, paymentMethods: ['Banesco', 'Mercantil'] },
          { operatorName: 'Trader 3', price: 85.8, completionRatePct: 92, totalOrdersCount: 150, paymentMethods: ['Zinli'] },
        ],
      });

      expect(result.marketMedianPrice).toBe(85.2);
      expect(result.ourPositionInRank).toBe(3);
      expect(result.isPriceCompetitive).toBe(true);
      expect(result.underservedPaymentMethods).toContain('Zinli');
    });
  });

  describe('orchestrateWorkspaceSync', () => {
    it('formats Notion and ClickUp payloads with priority tags', () => {
      const result = orchestrateWorkspaceSync({
        entityType: 'BANK_INCIDENT',
        referenceId: 'INC-2026-001',
        urgencyLevel: 'CRITICAL',
        operatorAssigned: 'Carlos Mendoza',
        summaryText: 'Bloqueo temporal preventivo en Banesco',
        metadataPayload: { affectedAmountUsdt: 3500 },
      });

      expect(result.syncPayload.event).toBe('P2P_EVENT_BANK_INCIDENT');
      expect(result.syncPayload.priorityColor).toBe('#FF453A');
      expect(result.syncPayload.clickUpTags).toContain('bank_incident');
      expect(result.retryPolicy.maxRetries).toBe(3);
    });
  });

  describe('executeDesktopRpaReconciliation', () => {
    it('matches valid references and flags amount mismatches and orphans', () => {
      const result = executeDesktopRpaReconciliation({
        bankName: 'Banesco',
        rawBankStatements: [
          { referenceNumber: 'REF1001', amount: 8500, beneficiaryOrPayer: 'Juan Perez', timestamp: '10:00' },
          { referenceNumber: 'REF1002', amount: 4200, beneficiaryOrPayer: 'Maria Gomez', timestamp: '10:15' },
          { referenceNumber: 'REF9999', amount: 1000, beneficiaryOrPayer: 'Desconocido', timestamp: '10:30' },
        ],
        registeredP2pOrders: [
          { orderId: 'ORD-1', expectedBankReference: 'REF1001', expectedAmountFiat: 8500, counterpartyRealName: 'Juan Perez' },
          { orderId: 'ORD-2', expectedBankReference: 'REF1002', expectedAmountFiat: 4300, counterpartyRealName: 'Maria Gomez' }, // Mismatch
        ],
      });

      expect(result.totalStatementsParsed).toBe(3);
      expect(result.matchedTransactionsCount).toBe(1);
      expect(result.unmatchedOrphanDepositsCount).toBe(1);
      expect(result.discrepanciesDetected.length).toBe(2);
      expect(result.status).toBe('DISCREPANCIES_FLAGGED');
    });
  });

  describe('monitorServiceHealthAndFallback', () => {
    it('triggers circuit breaker when services degrade below acceptable thresholds', () => {
      const result = monitorServiceHealthAndFallback({
        webSocketLatencyMs: 1500,
        bankApiUptimePct: 90,
        dbQueryResponseTimeMs: 250,
        unresolvedErrorsCount: 4,
      });

      expect(result.healthScore).toBeLessThan(50);
      expect(result.systemStatus).toBe('CIRCUIT_BREAKER_TRIGGERED');
      expect(result.fallbackActionEngaged).toBe(true);
    });
  });

  describe('triageIncidentAndEscalate', () => {
    it('assigns P1_CRITICAL to bank holds and requires human intervention', () => {
      const result = triageIncidentAndEscalate({
        incidentType: 'BANK_ACCOUNT_HOLD',
        amountAtRiskUsdt: 5000,
        orderId: 'ORD-CRISIS-1',
      });

      expect(result.severityLevel).toBe('P1_CRITICAL');
      expect(result.maxResolutionSlaMinutes).toBe(10);
      expect(result.requiresHumanHandoff).toBe(true);
      expect(result.recommendedRemediationSteps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('auditSopComplianceEnforcement', () => {
    it('penalizes releasing funds before bank balance verification', () => {
      const result = auditSopComplianceEnforcement({
        orderId: 'ORD-AUDIT-1',
        accountHolderMatchesDocument: true,
        bankBalanceConfirmedInAvailableFunds: false,
        responseTimeMinutes: 5,
        fundsReleasedBeforeBankVerification: true,
      });

      expect(result.isCompliant).toBe(false);
      expect(result.complianceScore).toBeLessThan(50);
      expect(result.disciplinaryAction).toBe('OPERATOR_DESK_SUSPENSION');
    });

    it('approves compliant orders without infractions', () => {
      const result = auditSopComplianceEnforcement({
        orderId: 'ORD-AUDIT-2',
        accountHolderMatchesDocument: true,
        bankBalanceConfirmedInAvailableFunds: true,
        responseTimeMinutes: 4,
        fundsReleasedBeforeBankVerification: false,
      });

      expect(result.isCompliant).toBe(true);
      expect(result.complianceScore).toBe(100);
      expect(result.disciplinaryAction).toBe('NONE');
    });
  });

  describe('syncGoogleSheetsLiveLedger', () => {
    it('generates dynamic formulas and row values for spreadsheet export', () => {
      const result = syncGoogleSheetsLiveLedger({
        tradeDate: '2026-09-18',
        orderId: 'ORD-12345',
        counterpartyAlias: 'BanescoPro',
        tradeType: 'SELL',
        cryptoAmountUsdt: 1000,
        fiatAmountVes: 85000,
        exchangeRate: 85.0,
        platformFeeUsdt: 1.0,
        bankTransferFeeVes: 25.0,
      });

      expect(result.rowValues.length).toBe(10);
      expect(result.formulaGrossProfit).toContain('IF');
      expect(result.formulaNetSpreadPct).toContain('100');
      expect(result.calculatedGrossProfitUsdt).toBeGreaterThan(0);
    });
  });

  describe('forecastCashFlowAndReconciliation', () => {
    it('recommends fiat rebalancing when bank balances exceed 35% of total capital', () => {
      const result = forecastCashFlowAndReconciliation({
        fiatBankBalancesTotalUsdtEquiv: 4500,
        cryptoExchangeBalancesUsdt: 5500,
        pendingUnsettledOrdersUsdt: 0,
        dailyProjectedVolumeUsdt: 3000,
        averageOperationalExpensesDailyUsdt: 50,
      });

      expect(result.fiatLiquidityRatioPct).toBe(45.0);
      expect(result.rebalanceRequired).toBe(true);
      expect(result.treasuryHealthVerdict).toBe('NEEDS_FIAT_REBALANCING');
      expect(result.recommendedUsdtReorderAmount).toBeGreaterThan(0);
    });
  });
});
