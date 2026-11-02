import { describe, it, expect } from 'vitest';
import {
  VENEZUELAN_FX_BANKS,
  computeAntiRejectionUsdLot,
  evaluateFxBankDeskPlan,
  resolveFxInterventionBankId,
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
});
