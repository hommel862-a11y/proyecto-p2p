import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ALL_MCP_TOOLS,
  MCP_TOOLS_BY_SERVER,
  f360GetTreasurySummaryTool,
  f360AnalyzeCasheaCapacityTool,
  f360SimulateCasheaAllyMarginTool,
  f360CheckPymeDrawersAndStockTool,
  f360GenerateQuoteEstimateTool,
  f360AuditOverdueAndRunwayTool,
  gdriveSyncDbBackupTool,
} from '../tools/index.js';
import { createP2PMcpServer } from '../server.js';
import { googleAuthAdapter } from '../adapters/google-auth.adapter.js';
import {
  F360SimulateCasheaAllyMarginInputSchema,
  GdriveSyncDbBackupInputSchema,
} from '../schemas/index.js';

describe('Finanzas 360 MCP Tools & Google Drive Hardening Suite', () => {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv['GOOGLE_ACCESS_TOKEN'] = process.env['GOOGLE_ACCESS_TOKEN'];
    savedEnv['GOOGLE_SERVICE_ACCOUNT_KEY_JSON'] = process.env['GOOGLE_SERVICE_ACCOUNT_KEY_JSON'];
    savedEnv['GOOGLE_APPLICATION_CREDENTIALS'] = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    delete process.env['GOOGLE_ACCESS_TOKEN'];
    delete process.env['GOOGLE_SERVICE_ACCOUNT_KEY_JSON'];
    delete process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    googleAuthAdapter.clearFolderCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    googleAuthAdapter.clearFolderCache();
    vi.restoreAllMocks();
  });

  describe('Registry & MCP Server wiring', () => {
    const expectedToolNames = [
      'f360_get_treasury_summary',
      'f360_analyze_cashea_capacity',
      'f360_simulate_cashea_ally_margin',
      'f360_check_pyme_drawers_and_stock',
      'f360_generate_quote_estimate',
      'f360_audit_overdue_and_runway',
    ];

    it('registers all 6 f360_* tools in ALL_MCP_TOOLS, p2p-finance-360, and p2p-decisor', () => {
      const allNames = ALL_MCP_TOOLS.map((t) => t.name);
      const f360ServerNames = (MCP_TOOLS_BY_SERVER['p2p-finance-360'] ?? []).map((t) => t.name);
      const decisorServerNames = (MCP_TOOLS_BY_SERVER['p2p-decisor'] ?? []).map((t) => t.name);

      for (const name of expectedToolNames) {
        expect(allNames).toContain(name);
        expect(f360ServerNames).toContain(name);
        expect(decisorServerNames).toContain(name);
      }
      expect(f360ServerNames).toHaveLength(6);
    });

    it('mounts all 6 f360_* tools cleanly on McpServer with Zod v4 shapes', () => {
      expect(() => createP2PMcpServer({ serverId: 'p2p-finance-360' })).not.toThrow();
    });
  });

  describe('f360_get_treasury_summary', () => {
    it('computes net worth USD/VES, liquid vs fixed assets, VES exposure, and FX rate gap', () => {
      const res = f360GetTreasurySummaryTool.execute({
        vaults: [
          { id: 'v1', name: 'Zelle USD', currency: 'USD', balance: 2000, scope: 'personal' },
          { id: 'v2', name: 'Binance USDT', currency: 'USDT', balance: 1000, scope: 'business' },
          { id: 'v3', name: 'Banesco Bs', currency: 'VES', balance: 80000, scope: 'business' },
          { id: 'v4', name: 'Caja EUR', currency: 'EUR', balance: 500, scope: 'personal' },
          {
            id: 'v5',
            name: 'Vehiculo Taller',
            currency: 'USD',
            balance: 5000,
            scope: 'business',
            isFixedAsset: true,
          },
        ],
        liabilities: [
          {
            id: 'l1',
            title: 'Cuota Cashea #1',
            remainingAmountUsd: 300,
            dueDate: '2026-11-28',
            status: 'pending',
          },
        ],
        bcvRate: 80,
        parallelRate: 96,
        eurUsdRate: 1.1,
        scope: 'all',
        referenceDateIso: '2026-11-20',
      });

      // USD: 2000 + 1000 + (80000/80=1000) + (500*1.1=550) + 5000 = 9550
      expect(res.totalAssetsUsd).toBe(9550);
      expect(res.liquidAssetsUsd).toBe(4550);
      expect(res.fixedAssetsUsd).toBe(5000);
      expect(res.totalLiabilitiesUsd).toBe(300);
      expect(res.netWorthUsd).toBe(9250);
      expect(res.netWorthVes).toBe(740000);
      expect(res.vesExposurePct).toBeCloseTo((1000 / 9550) * 100, 2);
      expect(res.rates.fxRateGapPct).toBe(20);
      expect(res.overdueCount).toBe(0);
      expect(res.liquidityHealth.status).toBe('optimal');
    });

    it('never invents FX fallback when bcvRate is 0 or omitted', () => {
      const res = f360GetTreasurySummaryTool.execute({
        vaults: [
          { id: 'v1', name: 'Cash USD', currency: 'USD', balance: 500 },
          { id: 'v2', name: 'Banesco Bs', currency: 'VES', balance: 100000 },
        ],
        liabilities: [],
        bcvRate: 0,
        scope: 'all',
        referenceDateIso: '2026-11-20',
      });

      expect(res.netWorthUsd).toBe(500);
      expect(res.netWorthVes).toBe(0);
      expect(res.unvaluedVesBalance).toBe(100000);
      expect(res.rates.isBcvRateLive).toBe(false);
      expect(res.rates.fxRateGapPct).toBeNull();
      expect(res.rates.missingFxRates).toContain('BCV');
    });

    it('forces critical liquidity semaphore when any liability is overdue regardless of cash', () => {
      const res = f360GetTreasurySummaryTool.execute({
        vaults: [{ id: 'v1', name: 'Zelle', currency: 'USD', balance: 50000 }],
        liabilities: [
          {
            id: 'l-overdue',
            title: 'Factura Vencida',
            remainingAmountUsd: 25,
            dueDate: '2026-11-18',
            status: 'pending',
          },
        ],
        bcvRate: 80,
        scope: 'all',
        referenceDateIso: '2026-11-20',
      });

      expect(res.overdueCount).toBe(1);
      expect(res.overdueUsd).toBe(25);
      expect(res.liquidityHealth.status).toBe('critical');
    });

    it('filters vaults and liabilities by scope cleanly', () => {
      const res = f360GetTreasurySummaryTool.execute({
        vaults: [
          { id: 'v1', name: 'Personal Cash', currency: 'USD', balance: 300, scope: 'personal' },
          { id: 'v2', name: 'Pyme Caja', currency: 'USD', balance: 1200, scope: 'business' },
        ],
        liabilities: [
          {
            id: 'l1',
            title: 'Proveedor',
            remainingAmountUsd: 400,
            dueDate: '2026-11-25',
            scope: 'business',
          },
          {
            id: 'l2',
            title: 'Alquiler Casa',
            remainingAmountUsd: 200,
            dueDate: '2026-11-25',
            scope: 'personal',
          },
        ],
        bcvRate: 80,
        scope: 'business',
        referenceDateIso: '2026-11-20',
      });

      expect(res.totalAssetsUsd).toBe(1200);
      expect(res.totalLiabilitiesUsd).toBe(400);
      expect(res.netWorthUsd).toBe(800);
    });
  });

  describe('f360_analyze_cashea_capacity', () => {
    it('applies exact Cashea 2026 Club Cashea Mas N1-N6 minimums and N6 Araguaney 0% campaign', () => {
      const n1Cot = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 100,
        level: 1,
        creditLine: 'cotidiana',
        installmentsCount: 3,
        biweeklySavingsCapacityUsd: 50,
        startDateIso: '2026-11-20',
      });
      expect(n1Cot.tier.name).toBe('Semilla');
      expect(n1Cot.effectiveInitialPercent).toBe(60);

      const n2Cot = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 100,
        level: 2,
        creditLine: 'cotidiana',
        installmentsCount: 3,
        biweeklySavingsCapacityUsd: 50,
        startDateIso: '2026-11-20',
      });
      expect(n2Cot.tier.name).toBe('Raíz');
      expect(n2Cot.effectiveInitialPercent).toBe(50);
      expect(n2Cot.tier.requiredSpentUsd).toBe(120);
      expect(n2Cot.tier.requiredInstallmentsPaid).toBe(5);

      const n4Cot = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 200,
        level: 4,
        creditLine: 'cotidiana',
        installmentsCount: 3,
        biweeklySavingsCapacityUsd: 80,
        startDateIso: '2026-11-20',
      });
      expect(n4Cot.tier.name).toBe('Tronco');
      expect(n4Cot.effectiveInitialPercent).toBe(25);

      const n6Campaign = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 1200,
        level: 6,
        creditLine: 'principal',
        installmentsCount: 12,
        zeroInitialCampaign: true,
        biweeklySavingsCapacityUsd: 200,
        startDateIso: '2026-11-20',
      });
      expect(n6Campaign.tier.name).toBe('Araguaney');
      expect(n6Campaign.tier.requiredSpentUsd).toBe(4000);
      expect(n6Campaign.tier.requiredInstallmentsPaid).toBe(80);
      expect(n6Campaign.effectiveInitialPercent).toBe(0);
      expect(n6Campaign.pathB_cashea.initialPaymentUsd).toBe(0);
      expect(n6Campaign.pathB_cashea.financedAmountUsd).toBe(1200);
      expect(n6Campaign.pathB_cashea.installments).toHaveLength(12);
      expect(n6Campaign.isInstallmentPlanEligible).toBe(true);
    });

    it('rejects 0% campaign on non-N6 or cotidiana and rejects Inicial Flexible below tier minimum', () => {
      const n5CampaignAttempt = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 900,
        level: 5,
        creditLine: 'principal',
        installmentsCount: 9,
        zeroInitialCampaign: true,
        customInitialPercent: 10,
        biweeklySavingsCapacityUsd: 100,
        startDateIso: '2026-11-20',
      });

      expect(n5CampaignAttempt.tier.name).toBe('Árbol');
      expect(n5CampaignAttempt.effectiveInitialPercent).toBe(40);
      expect(n5CampaignAttempt.policyWarnings.length).toBeGreaterThanOrEqual(2);

      // Extended installments ticket thresholds: N3 6 cuotas requires >= $700, N6 12 cuotas requires >= $1000
      const n3BelowThreshold = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 500,
        level: 3,
        creditLine: 'principal',
        installmentsCount: 6,
        biweeklySavingsCapacityUsd: 100,
        startDateIso: '2026-11-20',
      });
      expect(n3BelowThreshold.tier.name).toBe('Hoja');
      expect(n3BelowThreshold.isInstallmentPlanEligible).toBe(false);
      expect(n3BelowThreshold.policyWarnings.join(' ')).toContain('$700');
    });

    it('supports vehicular 12-24m monthly line, collision detector, Dual Projector, and Anti-Mora reference', () => {
      const vehicular = f360AnalyzeCasheaCapacityTool.execute({
        productPriceUsd: 2400,
        level: 5,
        creditLine: 'vehicular',
        installmentsCount: 18,
        customInitialPercent: 50,
        biweeklySavingsCapacityUsd: 150,
        startDateIso: '2026-11-20',
        existingDueDatesUsd: [{ dueDate: '2026-12-20', amountUsd: 180, label: 'Alquiler' }],
      });

      expect(vehicular.pathB_cashea.frequencyDays).toBe(30);
      expect(vehicular.pathB_cashea.installmentsCount).toBe(18);
      expect(vehicular.effectiveInitialPercent).toBe(50);
      expect(vehicular.pathB_cashea.collisionCount).toBeGreaterThanOrEqual(1);
      expect(vehicular.pathB_cashea.totalCollisionExposureUsd).toBeGreaterThanOrEqual(180);
      expect(vehicular.pathA_savings.biweeklyPeriodsNeeded).toBe(16);
      expect(vehicular.antiMoraReference.gracePeriodDays).toBe(2);
      expect(vehicular.antiMoraReference.reactivationFeeUsdPerInstallment).toBe(4);
      expect(vehicular.antiMoraReference.penaltyTiersDays).toEqual([7, 14, 28]);

      const sumInstallments = Number(
        vehicular.pathB_cashea.installments.reduce((s, i) => s + i.amountUsd, 0).toFixed(2),
      );
      expect(Number((vehicular.pathB_cashea.initialPaymentUsd + sumInstallments).toFixed(2))).toBe(
        2400,
      );
    });
  });

  describe('f360_simulate_cashea_ally_margin', () => {
    it('computes MDR, weekly advance, FX gap erosion, real net profit, break-even, and policyWarning', () => {
      const res = f360SimulateCasheaAllyMarginTool.execute({
        salePriceUsd: 200,
        costOfGoodsUsd: 140,
        mdrPercent: 4,
        useWeeklyAdvance: true,
        weeklyAdvanceFeePercent: 3,
        bcvRate: 80,
        parallelRate: 100,
        monthlyVolumeUsd: 1500,
        monthlyMinimumFeeUsd: 100,
        activationFeeUsd: 0,
      });

      // Gross profit = 60 (30%); MDR = 8; Advance = 6; Total fees = 14; Settlement BCV = 186 USD = 14,880 Bs
      // Real replacement at 100 = 148.80 USD; FX erosion = 37.20 USD; Real net profit = 8.80 USD (4.4%)
      expect(res.grossProfitUsd).toBe(60);
      expect(res.mdrFeeUsd).toBe(8);
      expect(res.weeklyAdvanceFeeUsd).toBe(6);
      expect(res.settlementUsdAtBcv).toBe(186);
      expect(res.fxGapPct).toBe(25);
      expect(res.fxGapErosionUsd).toBe(37.2);
      expect(res.realNetProfitUsd).toBe(8.8);
      expect(res.realNetMarginPct).toBe(4.4);
      expect(res.isSellingAtLoss).toBe(false);
      expect(res.breakEvenMonthlySalesForMinimumFeeUsd).toBe(2500);
      expect(res.coversMonthlyMinimum).toBe(false);
      expect(res.monthlyMinimumShortfallUsd).toBe(40);
      expect(res.policyWarning).toMatch(/recargo/i);
      expect(res.policyWarning).toContain('$25');
    });

    it('never invents FX rates when bcvRate or parallelRate are omitted and enforces schema ranges', () => {
      const res = f360SimulateCasheaAllyMarginTool.execute({
        salePriceUsd: 20,
        costOfGoodsUsd: 15,
        mdrPercent: 4,
        useWeeklyAdvance: false,
        weeklyAdvanceFeePercent: 3,
        monthlyMinimumFeeUsd: 100,
        activationFeeUsd: 0,
      });

      expect(res.fxRatesMissing).toBe(true);
      expect(res.fxGapPct).toBeNull();
      expect(res.fxGapErosionUsd).toBe(0);
      expect(res.belowMinimumTicket).toBe(true);

      const invalidMdr = F360SimulateCasheaAllyMarginInputSchema.safeParse({
        salePriceUsd: 100,
        costOfGoodsUsd: 50,
        mdrPercent: 9,
      });
      expect(invalidMdr.success).toBe(false);
    });
  });

  describe('f360_check_pyme_drawers_and_stock', () => {
    it('preserves real negative overdrafts in drawers, detects stock semaphores, and audits CxP', () => {
      const res = f360CheckPymeDrawersAndStockTool.execute({
        openingCapitalUsd: 200,
        drawerPercentages: {
          drawer1_replenishment: 50,
          drawer2_operations: 30,
          drawer3_profit: 20,
        },
        businessIncomes: [{ amountUsd: 300 }],
        businessExpenses: [
          { amountUsd: 400, category: 'provider_merchandise' }, // D1: 250 - 400 = -150 OVERDRAFT!
          { amountUsd: 100, category: 'payroll' }, // D2: 150 - 100 = +50
          { amountUsd: 20, category: 'equipment_capex' }, // D3: 100 - 20 = +80
        ],
        inventory: [
          {
            id: 'sku-1',
            name: 'Pintura Automotriz Roja',
            currentStock: 0,
            minimumStock: 5,
            unitCostUsd: 25,
          },
          {
            id: 'sku-2',
            name: 'Lija 1200',
            currentStock: 3,
            minimumStock: 10,
            unitCostUsd: 2,
          },
          {
            id: 'sku-3',
            name: 'Compresor Industrial',
            currentStock: 4,
            minimumStock: 1,
            unitCostUsd: 150,
            daysSinceLastSale: 62,
          },
        ],
        providers: [
          {
            id: 'prov-1',
            name: 'Distribuidora Química C.A.',
            outstandingDebtUsd: 320,
            dueDate: '2026-11-15',
          },
        ],
        referenceDateIso: '2026-11-20',
        coldStockThresholdDays: 45,
      });

      // NEVER clamped with Math.max(0, ...)
      expect(res.drawers.drawer1_replenishment.balanceUsd).toBe(-150);
      expect(res.drawers.drawer1_replenishment.isOverdrawn).toBe(true);
      expect(res.drawers.drawer1_replenishment.overdraftUsd).toBe(150);
      expect(res.drawers.drawer2_operations.balanceUsd).toBe(50);
      expect(res.drawers.drawer3_profit.balanceUsd).toBe(80);

      expect(res.inventorySummary.outOfStockCount).toBe(1);
      expect(res.inventorySummary.lowStockCount).toBe(1);
      expect(res.inventorySummary.coldStockCount).toBe(1);
      expect(res.inventorySummary.coldStockImmobilizedCapitalUsd).toBe(600);

      expect(res.providersSummary.totalProviderDebtUsd).toBe(320);
      expect(res.providersSummary.overdueProvidersCount).toBe(1);
      expect(res.providersSummary.canDrawer1CoverProviders).toBe(false);
      expect(res.overallHealth).toBe('critical');
    });
  });

  describe('f360_generate_quote_estimate', () => {
    it('computes prorated client lines summing to exact final total without exposing internal margin', () => {
      const res = f360GenerateQuoteEstimateTool.execute({
        industry: 'construction',
        lineItems: [
          { id: 'm1', category: 'material', name: 'Cemento Gris', quantity: 3, unit: 'saco', unitCostUsd: 11.11 },
          { id: 'm2', category: 'material', name: 'Arena Lavada', quantity: 3, unit: 'm3', unitCostUsd: 19.37 },
          { id: 'm3', category: 'logistics', name: 'Flete Camion', quantity: 1, unit: 'viaje', unitCostUsd: 27.5 },
        ],
        laborMode: 'per_m2',
        laborPercentage: 0,
        laborUnits: 12,
        laborUnitRateUsd: 8.5,
        includeTechnicalWaste: true,
        profitMarginPercent: 30,
        discountPercent: 5,
        applyIva: true,
        ivaPercent: 16,
        applyIgtf: true,
        igtfPercent: 3,
        advancePercent: 0,
        bcvRate: 80,
      });

      // Exact cent-level sum of client-facing lines === finalTotalUsd
      const proratedSum = Number(
        res.clientFacingQuote.clientLines.reduce((s, line) => s + line.clientLineTotalUsd, 0).toFixed(2),
      );
      expect(proratedSum).toBe(res.clientFacingQuote.finalTotalUsd);

      // Client lines must never expose internal cost or margin fields
      for (const line of res.clientFacingQuote.clientLines) {
        expect('unitCostUsd' in line).toBe(false);
        expect('rawUnitCostUsd' in line).toBe(false);
        expect('profitUsd' in line).toBe(false);
        expect(line.clientLineTotalUsd).toBeGreaterThan(0);
      }

      // 0% advance support
      expect(res.clientFacingQuote.advancePercent).toBe(0);
      expect(res.clientFacingQuote.advanceAmountUsd).toBe(0);
      expect(res.clientFacingQuote.balanceDueUsd).toBe(res.clientFacingQuote.finalTotalUsd);

      // Waste + IVA + IGTF verified
      expect(res.internalBreakdown.wasteUsd).toBeGreaterThan(0);
      expect(res.internalBreakdown.ivaUsd).toBeGreaterThan(0);
      expect(res.internalBreakdown.igtfUsd).toBeGreaterThan(0);
      expect(res.discountGuard.isBelowCost).toBe(false);
    });

    it('flags below-cost discount guard when discount wipes out profit margin', () => {
      const res = f360GenerateQuoteEstimateTool.execute({
        industry: 'workshop',
        lineItems: [{ id: 'm1', category: 'material', name: 'Kit Pintura', quantity: 1, unit: 'kit', unitCostUsd: 100 }],
        laborMode: 'percentage',
        laborPercentage: 20,
        laborUnits: 0,
        laborUnitRateUsd: 0,
        includeTechnicalWaste: false,
        profitMarginPercent: 20,
        discountPercent: 30,
        applyIva: false,
        ivaPercent: 16,
        applyIgtf: false,
        igtfPercent: 3,
        advancePercent: 50,
      });

      // Subtotal cost = 120; gross = 144; 30% discount => 100.80 < 120 cost!
      expect(res.discountGuard.isBelowCost).toBe(true);
      expect(res.discountGuard.belowCostDeficitUsd).toBe(19.2);
      expect(res.discountGuard.belowCostWarning).toBeTruthy();
    });
  });

  describe('f360_audit_overdue_and_runway', () => {
    it('audits VET overdue liabilities, Cashea grace/reactivation fees, and real runway from expenses', () => {
      const res = f360AuditOverdueAndRunwayTool.execute({
        liquidAssetsUsd: 900,
        liabilities: [
          { id: 'l1', title: 'Servicio Internet', remainingAmountUsd: 40, dueDate: '2026-11-15' },
        ],
        casheaInstallments: [
          { installmentNumber: 1, dueDate: '2026-11-19', amountUsd: 50, status: 'pending' }, // 1d overdue -> grace_2d ($0)
          { installmentNumber: 2, dueDate: '2026-11-10', amountUsd: 60, status: 'pending' }, // 10d overdue -> 7d penalty ($4)
          { installmentNumber: 3, dueDate: '2026-10-20', amountUsd: 70, status: 'pending' }, // 31d overdue -> 28d penalty ($4)
        ],
        expenses: [
          { date: '2026-11-01', amountUsd: 300, category: 'groceries' },
          { date: '2026-11-15', amountUsd: 300, category: 'housing' },
        ],
        burnWindowDays: 30,
        referenceDateIso: '2026-11-20',
      });

      expect(res.overdueLiabilities.count).toBe(1);
      expect(res.overdueLiabilities.totalUsd).toBe(40);
      expect(res.casheaAudit.inGraceCount).toBe(1);
      expect(res.casheaAudit.overduePenaltyCount).toBe(2);
      expect(res.casheaAudit.totalReactivationFeesUsd).toBe(8);
      expect(res.casheaAudit.installments[1]?.penaltyTier).toBe('7d');
      expect(res.casheaAudit.installments[2]?.penaltyTier).toBe('28d');

      // 600 USD over 30 days = $20/day, $600/month -> 900 / 20 = 45 days, 1.5 months
      expect(res.burnAndRunway.hasBurnEvidence).toBe(true);
      expect(res.burnAndRunway.dailyBurnRateUsd).toBe(20);
      expect(res.burnAndRunway.monthlyBurnRateUsd).toBe(600);
      expect(res.burnAndRunway.runwayDays).toBe(45);
      expect(res.burnAndRunway.runwayMonths).toBe(1.5);
    });

    it('never invents synthetic burn when expense history is empty', () => {
      const res = f360AuditOverdueAndRunwayTool.execute({
        liquidAssetsUsd: 1500,
        liabilities: [],
        casheaInstallments: [],
        expenses: [],
        burnWindowDays: 30,
        referenceDateIso: '2026-11-20',
      });

      expect(res.burnAndRunway.hasBurnEvidence).toBe(false);
      expect(res.burnAndRunway.dailyBurnRateUsd).toBeNull();
      expect(res.burnAndRunway.monthlyBurnRateUsd).toBeNull();
      expect(res.burnAndRunway.runwayDays).toBeNull();
      expect(res.burnAndRunway.runwayMonths).toBeNull();
      expect(res.burnAndRunway.runwayStatus).toBe('UNAVAILABLE_NO_EXPENSE_HISTORY');
    });
  });

  describe('Google Drive real folderPath resolution & honest sync status', () => {
    it('resolves hierarchical folder paths, escapes single quotes, creates missing folders, and caches results', async () => {
      const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
      let createdSeq = 0;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        fetchCalls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });

        if (method === 'GET' && url.includes('drive/v3/files')) {
          if (url.includes(encodeURIComponent("name='HOMEL_360'"))) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'drv-folder-root-360', name: 'HOMEL_360' }] }),
            } as unknown as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          } as unknown as Response;
        }

        if (method === 'POST' && url.includes('drive/v3/files')) {
          createdSeq += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: `drv-created-${createdSeq}`, name: 'created' }),
          } as unknown as Response;
        }

        return { ok: false, status: 500, text: async () => 'unexpected' } as unknown as Response;
      }) as unknown as typeof fetch;

      const folderId = await googleAuthAdapter.resolveFolderPath(
        "/HOMEL_360/O'Connor_Backups",
        'live-token-xyz',
      );
      expect(folderId).toBe('drv-created-1');
      // Escaped single quote in query for O'Connor_Backups
      const secondSearchCall = fetchCalls.find(
        (c) => c.method === 'GET' && c.url.includes('Connor_Backups'),
      );
      expect(decodeURIComponent(secondSearchCall?.url ?? '')).toContain("name='O\\'Connor_Backups'");
      expect(decodeURIComponent(secondSearchCall?.url ?? '')).toContain("'drv-folder-root-360' in parents");

      const callsAfterFirst = fetchCalls.length;
      const cachedFolderId = await googleAuthAdapter.resolveFolderPath(
        "/HOMEL_360/O'Connor_Backups",
        'live-token-xyz',
      );
      expect(cachedFolderId).toBe('drv-created-1');
      expect(fetchCalls.length).toBe(callsAfterFirst);
    });

    it('resolves folderPath (and legacy slash folderId) during LIVE upload and never sends Unix paths in parents', async () => {
      process.env['GOOGLE_ACCESS_TOKEN'] = 'oauth-live-token';
      let capturedMultipartBody = '';

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.includes('drive/v3/files')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: 'real-drive-id-999', name: 'Backups' }] }),
          } as unknown as Response;
        }

        if (method === 'POST' && url.includes('upload/drive/v3/files')) {
          capturedMultipartBody = Buffer.isBuffer(init?.body)
            ? init.body.toString('utf8')
            : String(init?.body ?? '');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'uploaded-file-777',
              name: 'backup.json',
              webViewLink: 'https://drive.google.com/file/d/uploaded-file-777/view',
              webContentLink: 'https://drive.google.com/uc?id=uploaded-file-777&export=download',
            }),
          } as unknown as Response;
        }

        return { ok: false, status: 500, text: async () => 'unexpected' } as unknown as Response;
      }) as unknown as typeof fetch;

      const parsedInput = GdriveSyncDbBackupInputSchema.parse({
        backupType: 'ledger_json',
        dataPayload: JSON.stringify({ ok: true }),
        folderPath: '/HOMEL_360/Backups',
        encrypt: true,
      });

      const res = await gdriveSyncDbBackupTool.execute(parsedInput);
      expect(res.success).toBe(true);
      expect(res.mode).toBe('LIVE');
      expect(res.liveUploaded).toBe(true);
      expect(res.simulated).toBe(false);
      expect(res.resolvedFolderId).toBe('real-drive-id-999');
      expect(capturedMultipartBody).toContain('"parents":["real-drive-id-999"]');
      expect(capturedMultipartBody).not.toContain('"/HOMEL_360/Backups"');
    });

    it('reports honest DISCONNECTED failure when LIVE credentials exist but Drive upload fails', async () => {
      process.env['GOOGLE_ACCESS_TOKEN'] = 'expired-token';

      globalThis.fetch = vi.fn(async () => {
        return {
          ok: false,
          status: 401,
          text: async () => 'Invalid Credentials',
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const res = await gdriveSyncDbBackupTool.execute({
        backupType: 'ledger_json',
        dataPayload: JSON.stringify({ test: 1 }),
        folderPath: '/HOMEL_360/Backups',
        encrypt: false,
      });

      expect(res.mode).toBe('DISCONNECTED');
      expect(res.success).toBe(false);
      expect(res.liveUploaded).toBe(false);
      expect(res.simulated).toBe(false);
      expect(res.error).toBeTruthy();
    });

    it('treats legacy slash folderId as folderPath and returns DISCONNECTED when credentials lack access token', async () => {
      process.env['GOOGLE_ACCESS_TOKEN'] = 'oauth-live-token';
      let capturedMultipartBody = '';

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('drive/v3/files')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: 'resolved-legacy-id-42', name: 'Backups' }] }),
          } as unknown as Response;
        }
        capturedMultipartBody = Buffer.isBuffer(init?.body)
          ? init.body.toString('utf8')
          : String(init?.body ?? '');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'file-legacy-ok', name: 'snap.json' }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const legacyRes = await googleAuthAdapter.uploadDriveFile({
        name: 'snap.json',
        mimeType: 'application/json',
        data: '{"ok":true}',
        folderId: '/HOMEL_360/Backups',
      });
      expect(legacyRes.mode).toBe('LIVE');
      expect(legacyRes.resolvedFolderId).toBe('resolved-legacy-id-42');
      expect(capturedMultipartBody).toContain('"parents":["resolved-legacy-id-42"]');
      expect(capturedMultipartBody).not.toContain('"/HOMEL_360/Backups"');

      // Now simulate Service Account configured without active OAuth access token -> honest DISCONNECTED
      delete process.env['GOOGLE_ACCESS_TOKEN'];
      process.env['GOOGLE_SERVICE_ACCOUNT_KEY_JSON'] = JSON.stringify({
        client_email: 'svc@test.iam.gserviceaccount.com',
        project_id: 'proj-test',
      });
      const noTokenRes = await googleAuthAdapter.uploadDriveFile({
        name: 'snap.json',
        mimeType: 'application/json',
        data: '{"ok":true}',
        folderPath: '/HOMEL_360/Backups',
      });
      expect(noTokenRes.mode).toBe('DISCONNECTED');
      expect(noTokenRes.error).toBeTruthy();
    });
  });
});
