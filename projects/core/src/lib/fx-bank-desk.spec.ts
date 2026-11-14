import { describe, it, expect } from 'vitest';
import {
  VENEZUELAN_FX_BANKS,
  computeAntiRejectionUsdLot,
  detectFxInterventionReceipt,
  evaluateFxBankDeskPlan,
  matchAccountsForFxBank,
  resolveFxInterventionBankId,
  selectPrimaryFxBankAccount,
} from './fx-bank-desk';
import type { BankAccount, AccountUsage } from './accounts';

describe('fx-bank-desk domain engine', () => {
  it('models all 14 Venezuelan public and private banks with valid rules', () => {
    expect(VENEZUELAN_FX_BANKS.length).toBe(14);
    const stateBanks = VENEZUELAN_FX_BANKS.filter((b) => b.sector === 'ESTADO');
    const privateBanks = VENEZUELAN_FX_BANKS.filter((b) => b.sector === 'PRIVADO');
    expect(stateBanks.map((b) => b.id)).toEqual(['BDV', 'BICENTENARIO', 'TESORO']);
    expect(privateBanks.length).toBe(11);
    for (const bank of VENEZUELAN_FX_BANKS) {
      expect(bank.minLotUsd).toBeGreaterThan(0);
      expect(bank.lotStepUsd).toBeGreaterThan(0);
      expect(bank.portalUrl.startsWith('https://')).toBe(true);
    }
  });

  it('computes anti-rejection USD lots rounded to bank step multiples and reserving fee + buffer', () => {
    const bdv = VENEZUELAN_FX_BANKS.find((b) => b.id === 'BDV')!;
    // 50,000 VES at 62.50 VES/USD -> raw is 800 USD, but reserving 0.25% fee + 0.50% safety buffer
    // effective rate = 62.50 * 1.0075 = 62.96875 -> max raw = 794.04 USD -> stepped by $5 = $790 USD
    const lot = computeAntiRejectionUsdLot(50000, 62.5, bdv);
    expect(lot.orderUsd).toBe(790);
    expect(lot.orderUsd % bdv.lotStepUsd).toBe(0);
    expect(lot.totalDebitVes).toBeLessThanOrEqual(50000);
    expect(lot.safetyBufferVes).toBeGreaterThan(0);
  });

  it('returns 0 orderUsd when deployable VES is below bank minimum lot', () => {
    const banplus = VENEZUELAN_FX_BANKS.find((b) => b.id === 'BANPLUS')!; // minLotUsd: 50
    const lot = computeAntiRejectionUsdLot(1500, 62.5, banplus); // ~24 USD < 50 USD
    expect(lot.orderUsd).toBe(0);
    expect(lot.totalDebitVes).toBe(0);
  });

  it('fails closed when BCV or P2P rates are missing or non-positive', () => {
    const planMissingBcv = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: null,
      p2pSellRateVes: 84.5,
      simulatedCapitalVes: 100000,
    });
    expect(planMissingBcv.actionable).toBe(false);
    expect(planMissingBcv.grossGapPct).toBeNull();
    expect(planMissingBcv.unavailableReason).toContain('BCV');

    const planMissingP2p = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: null,
      simulatedCapitalVes: 100000,
    });
    expect(planMissingP2p.actionable).toBe(false);
    expect(planMissingP2p.totalProjectedNetProfitVes).toBeNull();
  });

  it('computes net arbitrage profit across accounts and respects SUDEBAN saturation blocks', () => {
    const accounts: BankAccount[] = [
      {
        id: 'bdv-1',
        bankName: 'BDV Transferencia',
        bankCode: 'BDV',
        rail: 'TRANSFERENCIA',
        accountNumberMasked: '0102-***1111',
        dailyLimitVes: 250000,
        initialBalanceVes: 100000,
      },
      {
        id: 'banesco-1',
        bankName: 'Banesco Transferencia',
        bankCode: 'BANESCO',
        rail: 'TRANSFERENCIA',
        accountNumberMasked: '0134-***2222',
        dailyLimitVes: 100000,
        initialBalanceVes: 90000,
      },
    ];
    const usages: AccountUsage[] = [
      {
        account: accounts[0],
        spentTodayVes: 0,
        receivedTodayVes: 0,
        currentBalanceVes: 100000,
        consumedLimitPct: 0,
        remainingLimitVes: 250000,
        isNearLimit: false,
        isOverLimit: false,
        spentThisMonthVes: 0,
        consumedMonthlyLimitPct: 0,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: false,
      },
      {
        account: accounts[1],
        spentTodayVes: 100000,
        receivedTodayVes: 0,
        currentBalanceVes: 90000,
        consumedLimitPct: 100,
        remainingLimitVes: 0,
        isNearLimit: false,
        isOverLimit: true,
        spentThisMonthVes: 100000,
        consumedMonthlyLimitPct: 100,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: true,
      },
    ];

    const plan = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: 84.0,
      accounts,
      usages,
      confirmedFluidBanks: ['BDV'],
      depletedBanks: ['MERCANTIL'],
    });

    expect(plan.actionable).toBe(true);
    expect(plan.grossGapPct).toBeCloseTo(34.4, 1);

    const bdvTicket = plan.tickets.find((t) => t.bank.id === 'BDV')!;
    expect(bdvTicket.isViableOrder).toBe(true);
    expect(bdvTicket.signalState).toBe('CONFIRMED_FLUID');
    expect(bdvTicket.recommendedOrderUsd).toBeGreaterThan(0);
    expect(bdvTicket.projectedNetProfitVes).toBeGreaterThan(0);

    const banescoTicket = plan.tickets.find((t) => t.bank.id === 'BANESCO')!;
    expect(banescoTicket.sudebanHealth).toBe('BLOCKED_LIMIT');
    expect(banescoTicket.isViableOrder).toBe(false);

    const mercantilTicket = plan.tickets.find((t) => t.bank.id === 'MERCANTIL')!;
    expect(mercantilTicket.signalState).toBe('COOLDOWN_DEPLETED');
    expect(mercantilTicket.isViableOrder).toBe(false);
  });

  it('resolves bank identifiers by code, name, or ABA prefix', () => {
    expect(resolveFxInterventionBankId('bdv')).toBe('BDV');
    expect(resolveFxInterventionBankId('0172')).toBe('BANCAMIGA');
    expect(resolveFxInterventionBankId('100%')).toBe('CIEN_BANCO');
    expect(resolveFxInterventionBankId('bicentenario')).toBe('BICENTENARIO');
    expect(resolveFxInterventionBankId('unknown-xyz')).toBeNull();
  });

  it('prevents coreBankCode OTRO collision across extended banks and honors ABA prefix', () => {
    const plazaAccount: BankAccount = {
      id: 'acc-1',
      bankName: 'Plaza Mesa Divisas',
      bankCode: 'OTRO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0138-***0001',
      dailyLimitVes: 250000,
      initialBalanceVes: 150000,
    };
    const plazaProfile = VENEZUELAN_FX_BANKS.find((b) => b.id === 'PLAZA')!;
    const tesoroProfile = VENEZUELAN_FX_BANKS.find((b) => b.id === 'TESORO')!;

    expect(matchAccountsForFxBank(plazaProfile, [plazaAccount]).length).toBe(1);
    expect(matchAccountsForFxBank(tesoroProfile, [plazaAccount]).length).toBe(0);
  });

  it('applies per-bank exit rail overrides to net USDT and profit calculations', () => {
    const planDefault = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 60.0,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: 65000,
    });
    const planOverridden = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 60.0,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: 65000,
      exitRailOverrides: { BANCAMIGA: 'INTERNAL_USD_P2P' },
    });

    const bDefault = planDefault.tickets.find((t) => t.bank.id === 'BANCAMIGA')!;
    const bOverride = planOverridden.tickets.find((t) => t.bank.id === 'BANCAMIGA')!;
    expect(bDefault.activeExitRail).toBe('INTL_DEBIT_CARD');
    expect(bOverride.activeExitRail).toBe('INTERNAL_USD_P2P');
    expect(bOverride.netUsdtAfterExitRail).toBeGreaterThan(bDefault.netUsdtAfterExitRail);
  });

  it('detects FX intervention receipts from OCR text and extracts USD lot and BCV rate', () => {
    const parsed = detectFxInterventionReceipt(
      'COMPROBANTE COMPRA DE DIVISAS MENUDEO BANCO DE VENEZUELA MONTO: USD 250.00 TASA BCV: 62.45',
    );
    expect(parsed.isFxPurchase).toBe(true);
    expect(parsed.bankId).toBe('BDV');
    expect(parsed.usdAmount).toBe(250);
    expect(parsed.bcvRateVes).toBeCloseTo(62.45, 2);
  });

  it('selectPrimaryFxBankAccount prioritizes TRANSFERENCIA rail over PAGO_MOVIL regardless of array order', () => {
    const bdvProfile = VENEZUELAN_FX_BANKS.find((b) => b.id === 'BDV')!;
    const accounts: BankAccount[] = [
      {
        id: 'bdv-pm',
        bankName: 'Banco de Venezuela Pago Móvil',
        bankCode: 'BDV',
        rail: 'PAGO_MOVIL',
        accountNumberMasked: '0414-***0001',
        dailyLimitVes: 250000,
        initialBalanceVes: 100000,
      },
      {
        id: 'bdv-tr',
        bankName: 'Banco de Venezuela Transferencia',
        bankCode: 'BDV',
        rail: 'TRANSFERENCIA',
        accountNumberMasked: '0102-***2222',
        dailyLimitVes: 500000,
        initialBalanceVes: 40000,
      },
    ];
    const usages: AccountUsage[] = [
      {
        account: accounts[0],
        spentTodayVes: 0,
        receivedTodayVes: 0,
        currentBalanceVes: 100000,
        consumedLimitPct: 0,
        remainingLimitVes: 250000,
        isNearLimit: false,
        isOverLimit: false,
        spentThisMonthVes: 0,
        consumedMonthlyLimitPct: 0,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: false,
      },
      {
        account: accounts[1],
        spentTodayVes: 0,
        receivedTodayVes: 0,
        currentBalanceVes: 40000,
        consumedLimitPct: 0,
        remainingLimitVes: 500000,
        isNearLimit: false,
        isOverLimit: false,
        spentThisMonthVes: 0,
        consumedMonthlyLimitPct: 0,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: false,
      },
    ];

    const primary = selectPrimaryFxBankAccount(bdvProfile, accounts, usages);
    expect(primary.account).not.toBeNull();
    expect(primary.account!.id).toBe('bdv-tr');
    expect(primary.account!.rail).toBe('TRANSFERENCIA');
    expect(primary.usage?.account.id).toBe('bdv-tr');
    expect(primary.eligibleAccounts.every((a) => a.rail === 'TRANSFERENCIA')).toBe(true);

    const mercantilProfile = VENEZUELAN_FX_BANKS.find((b) => b.id === 'MERCANTIL')!;
    const none = selectPrimaryFxBankAccount(mercantilProfile, accounts, usages);
    expect(none.account).toBeNull();
    expect(none.usage).toBeNull();
  });

  it('honors real 0 Bs balance on linked primary account instead of falling back to simulatedCapitalVes or summing PAGO_MOVIL', () => {
    const accounts: BankAccount[] = [
      {
        id: 'bdv-pm-rich',
        bankName: 'Banco de Venezuela Pago Móvil',
        bankCode: 'BDV',
        rail: 'PAGO_MOVIL',
        accountNumberMasked: '0414-***8888',
        dailyLimitVes: 250000,
        initialBalanceVes: 150000,
      },
      {
        id: 'bdv-zero-tr',
        bankName: 'Banco de Venezuela Transferencia',
        bankCode: 'BDV',
        rail: 'TRANSFERENCIA',
        accountNumberMasked: '0102-***9999',
        dailyLimitVes: 500000,
        initialBalanceVes: 0,
      },
    ];
    const usages: AccountUsage[] = [
      {
        account: accounts[0],
        spentTodayVes: 0,
        receivedTodayVes: 0,
        currentBalanceVes: 150000,
        consumedLimitPct: 0,
        remainingLimitVes: 250000,
        isNearLimit: false,
        isOverLimit: false,
        spentThisMonthVes: 0,
        consumedMonthlyLimitPct: 0,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: false,
      },
      {
        account: accounts[1],
        spentTodayVes: 0,
        receivedTodayVes: 0,
        currentBalanceVes: 0,
        consumedLimitPct: 0,
        remainingLimitVes: 500000,
        isNearLimit: false,
        isOverLimit: false,
        spentThisMonthVes: 0,
        consumedMonthlyLimitPct: 0,
        isNearMonthlyLimit: false,
        isOverMonthlyLimit: false,
      },
    ];

    const plan = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: 200000,
      accounts,
      usages,
      capitalAllocationMode: 'PER_BANK',
    });

    const bdvTicket = plan.tickets.find((t) => t.bank.id === 'BDV')!;
    expect(bdvTicket.isViableOrder).toBe(false);
    expect(bdvTicket.recommendedOrderUsd).toBe(0);
  });

  it('splits a single capital pool across top banks in DISTRIBUTE_TOTAL mode without exceeding total VES budget', () => {
    const budgetVes = 100000;
    const perBankPlan = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: budgetVes,
      accounts: [],
      usages: [],
      capitalAllocationMode: 'PER_BANK',
    });

    const distributePlan = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: budgetVes,
      accounts: [],
      usages: [],
      capitalAllocationMode: 'DISTRIBUTE_TOTAL',
    });

    expect(distributePlan.actionable).toBe(true);
    expect(distributePlan.totalDeployableVes).toBeGreaterThan(0);
    expect(distributePlan.totalDeployableVes).toBeLessThanOrEqual(budgetVes + 0.01);
    expect(perBankPlan.totalDeployableVes).toBeGreaterThan(budgetVes);
  });

  it('ranks and sorts tickets in descending order by executionScore', () => {
    const plan = evaluateFxBankDeskPlan({
      bcvOfficialRateVes: 62.5,
      p2pSellRateVes: 84.0,
      simulatedCapitalVes: 120000,
      accounts: [],
      usages: [],
      confirmedFluidBanks: ['BANESCO'],
      depletedBanks: ['MERCANTIL'],
      isBcvWindowOpen: true,
    });

    for (let i = 0; i < plan.tickets.length - 1; i++) {
      expect(plan.tickets[i].executionScore).toBeGreaterThanOrEqual(
        plan.tickets[i + 1].executionScore,
      );
    }

    const banescoIndex = plan.tickets.findIndex((t) => t.bank.id === 'BANESCO');
    const mercantilIndex = plan.tickets.findIndex((t) => t.bank.id === 'MERCANTIL');
    expect(banescoIndex).toBeGreaterThanOrEqual(0);
    expect(mercantilIndex).toBeGreaterThan(banescoIndex);
  });
});
