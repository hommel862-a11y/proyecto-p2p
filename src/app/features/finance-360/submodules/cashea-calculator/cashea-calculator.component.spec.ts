import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CasheaCalculatorComponent } from './cashea-calculator.component';
import { Finance360Service } from '../../../../core/finance-360.service';
import { IndexedDbStorageService } from '../../../../core/indexed-db-storage.service';
import { AccountsService } from '../../../../core/accounts.service';
import { CotizaveService } from '../../../../core/cotizave.service';
import { ToastService } from '../../../../core/toast.service';
import {
  CASHEA_CLUB_TIERS,
  addCalendarDays,
  computeTriMonetaryAmount,
  todayVetIso,
  type CasheaLevel,
} from '../../../../core/models/finance-360.models';
import type { CotizaveRate } from '@p2p/core';

describe('CasheaCalculatorComponent (Club Cashea Mas N1-N6 Institutional)', () => {
  let fixture: ComponentFixture<CasheaCalculatorComponent>;
  let component: CasheaCalculatorComponent;
  let financeService: Finance360Service;
  let toastService: ToastService;
  let ratesSignal: WritableSignal<Record<string, CotizaveRate>>;
  let storageMap: Map<string, unknown>;

  function setup(initialRates?: Record<string, CotizaveRate>): void {
    TestBed.resetTestingModule();
    storageMap = new Map<string, unknown>();
    ratesSignal = signal<Record<string, CotizaveRate>>(
      initialRates ?? {
        oficial: { market: 'bcv', type: 'reference', mid: 60.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 72.0 },
      },
    );

    TestBed.configureTestingModule({
      imports: [CasheaCalculatorComponent],
      providers: [
        Finance360Service,
        ToastService,
        {
          provide: IndexedDbStorageService,
          useValue: {
            get: vi.fn(<T>(key: string): T | null => (storageMap.get(key) as T) ?? null),
            set: vi.fn((key: string, val: unknown) => {
              storageMap.set(key, val);
            }),
            remove: vi.fn((key: string) => {
              storageMap.delete(key);
            }),
          },
        },
        {
          provide: AccountsService,
          useValue: {
            todayOperations: vi.fn().mockReturnValue([]),
            accounts: vi.fn().mockReturnValue([]),
          },
        },
        {
          provide: CotizaveService,
          useValue: { ratesByMarket: ratesSignal },
        },
      ],
    });

    financeService = TestBed.inject(Finance360Service);
    toastService = TestBed.inject(ToastService);
    vi.spyOn(toastService, 'success');
    vi.spyOn(toastService, 'warn');
    vi.spyOn(toastService, 'info');

    fixture = TestBed.createComponent(CasheaCalculatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all 6 Club Cashea Mas tiers (N1 Semilla to N6 Araguaney), N6 0% campaign, and flexible initial percentage', () => {
    expect(component.clubTiers.length).toBe(6);
    expect(component.clubTiers.map((t) => t.name)).toEqual([
      'Semilla',
      'Raíz',
      'Hoja',
      'Tronco',
      'Árbol',
      'Araguaney',
    ]);

    const levelButtons = fixture.nativeElement.querySelectorAll('.level-pill') as NodeListOf<HTMLButtonElement>;
    expect(levelButtons.length).toBe(6);

    // Level 4 Tronco: 40% Principal / 25% Cotidiana (correcting legacy N4 bug)
    component.totalAmountUsd.set(200);
    component.setLevel(4);
    component.setCreditLine('principal');
    expect(component.calculation().initialPercent).toBe(CASHEA_CLUB_TIERS[4].principalInitialPercent);
    expect(component.calculation().initialPaymentUsd).toBe(80);

    component.setCreditLine('cotidiana');
    expect(component.calculation().initialPercent).toBe(CASHEA_CLUB_TIERS[4].cotidianaInitialPercent);
    expect(component.calculation().initialPaymentUsd).toBe(50);

    // Level 6 Araguaney + 0% campaign initial
    component.setLevel(6);
    component.setCreditLine('principal');
    component.enableZeroInitialCampaign();
    expect(component.calculation().initialPercent).toBe(0);
    expect(component.calculation().initialPaymentUsd).toBe(0);
    expect(component.calculation().financedAmountUsd).toBe(200);

    // Flexible Initial override (custom 55%)
    component.setCustomInitialPercent(55);
    expect(component.calculation().initialPercent).toBe(55);
    expect(component.calculation().initialPaymentUsd).toBe(110);
    expect(component.calculation().financedAmountUsd).toBe(90);

    // Profile editor updates Club Cashea Mas limits cleanly
    component.openProfileEditor();
    component.profileDraftLevel.set(5 as CasheaLevel);
    component.profileDraftPrincipalLimit.set(600);
    component.profileDraftCotidianaLimit.set(250);
    component.saveProfileEditor();
    expect(financeService.casheaProfile().level).toBe(5);
    expect(financeService.casheaProfile().principalLimitUsd).toBe(600);
    expect(financeService.casheaProfile().cotidianaLimitUsd).toBe(250);
  });

  it('keeps installments strictly numeric across standard (1/3/6/9/12) and vehicular (12/18/24) lines', () => {
    component.setLevel(6);
    component.setCreditLine('principal');
    component.setInstallments(9);
    expect(component.totalInstallments()).toBe(9);
    expect(typeof component.totalInstallments()).toBe('number');
    expect(component.calculation().installmentsCount).toBe(9);
    expect(component.calculation().frequencyDays).toBe(14);

    component.setCreditLine('vehicular');
    expect(component.availableInstallmentOptions()).toEqual([12, 18, 24]);
    expect(component.totalInstallments()).toBe(12);
    expect(component.calculation().frequencyDays).toBe(30);

    component.setInstallments(24);
    expect(component.totalInstallments()).toBe(24);
    expect(component.calculation().installments.length).toBe(24);
  });

  it('defaults payment vault dynamically (never ghost vault-banco-bs) and preserves exact VET firstDueDate on save', () => {
    // Zero vaults: must be empty string, never 'vault-banco-bs'
    expect(component.selectedPaymentVaultId()).toBe('');
    expect(fixture.nativeElement.textContent as string).toContain('Sin bóvedas registradas');

    // Add a real vault -> automatically selected
    const vault = financeService.addAssetVault({
      name: 'Mercantil Bs',
      channel: 'bs_bank',
      scope: 'personal',
      currency: 'VES',
      balance: 30000, // $500 USD at BCV 60
      balanceUsdEquivalent: 500,
      balanceVesEquivalent: 30000,
    });
    fixture.detectChanges();
    expect(component.selectedPaymentVaultId()).toBe(vault.id);

    // Set explicit VET firstDueDate and verify 100% match between preview and saved plan/liabilities
    const exactFirstDue = '2026-07-01';
    component.itemTitle.set('Cauchos Rin 15');
    component.storeName.set('Ferretería EPA');
    component.totalAmountUsd.set(300);
    component.setLevel(3);
    component.setCreditLine('principal');
    component.setInstallments(3);
    component.firstDueDate.set(exactFirstDue);
    fixture.detectChanges();

    expect(component.projectedDates()[0].dateStr).toBe(exactFirstDue);
    expect(component.projectedDates()[1].dateStr).toBe('2026-07-15');
    expect(component.projectedDates()[2].dateStr).toBe('2026-07-29');

    component.savePlan();

    const savedPlan = financeService.state().casheaPlans[0];
    expect(savedPlan).toBeDefined();
    expect(savedPlan.startDate).toBe(exactFirstDue);
    expect(savedPlan.installments[0].dueDate).toBe(exactFirstDue);
    expect(savedPlan.installments[1].dueDate).toBe('2026-07-15');
    expect(savedPlan.installments[2].dueDate).toBe('2026-07-29');

    const linkedLiabs = financeService
      .state()
      .liabilities.filter((l) => l.casheaPlanId === savedPlan.id);
    expect(linkedLiabs.map((l) => l.dueDate)).toEqual(['2026-07-01', '2026-07-15', '2026-07-29']);
  });

  it('computes Dual Projector (Path A Savings vs Path B Cashea) and detects 14D biweekly collisions', () => {
    const firstDue = addCalendarDays(todayVetIso(), 14);
    component.totalAmountUsd.set(300);
    component.setLevel(3);
    component.setCreditLine('principal');
    component.setInstallments(3); // $120 initial, $60/installment
    component.firstDueDate.set(firstDue);

    // High savings capacity with no collisions -> cashea_viable
    component.biweeklySavingsCapacityUsd.set(150);
    expect(component.dualProjection().recommendation).toBe('cashea_viable');
    expect(component.dualProjection().pathA_savings.debtRisk).toBe('none');

    // Low savings capacity -> save_cash_recommended
    component.biweeklySavingsCapacityUsd.set(40);
    expect(component.dualProjection().recommendation).toBe('save_cash_recommended');

    // Add colliding liability + active recurring rule within 2D window of firstDue
    financeService.addLiability({
      title: 'Alquiler Mensual',
      creditor: 'Arrendador',
      scope: 'personal',
      category: 'fixed_service',
      triMonetary: computeTriMonetaryAmount(180, 'USD', 60, 72),
      dueDate: firstDue,
      status: 'pending',
      amountPaid: 0,
      remainingAmount: 180,
    });
    financeService.addRecurringRule({
      title: 'Internet Fibra',
      type: 'expense',
      scope: 'personal',
      category: 'services',
      channel: 'bs_bank',
      currency: 'USD',
      amount: 45,
      frequency: 'biweekly',
      nextDueDate: addCalendarDays(firstDue, 1),
      active: true,
    });
    fixture.detectChanges();

    const collisions = component.collisions14D();
    expect(collisions[0].date).toBe(firstDue);
    expect(collisions[0].collisionCount).toBe(2);
    expect(collisions[0].severity).toBe('high');
    expect(collisions[0].totalExistingCommittedUsd).toBe(225);
  });

  it('separates active vs completed plans, surfaces Anti-Mora 2D grace / $4 reactivation badges, and supports partial abono & reverse delete', () => {
    const vault = financeService.addAssetVault({
      name: 'Zelle Personal',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 1000,
      balanceUsdEquivalent: 1000,
      balanceVesEquivalent: 60000,
    });
    fixture.detectChanges();

    // Plan 1: overdue by 10 days -> Mora +$4 reactivación + 7d penalty tier
    const overdue10d = addCalendarDays(todayVetIso(), -10);
    const overdueSchedule = financeService.calculateCasheaSchedule(200, 3, 3, {
      firstDueDate: overdue10d,
    });
    const overduePlan = financeService.registerCasheaPlan({
      productName: 'Monitor 27',
      storeName: 'Daka',
      scope: 'personal',
      level: 3,
      creditLine: 'principal',
      totalPriceUsd: 200,
      initialPaymentUsd: overdueSchedule.initialPaymentUsd,
      initialPercentage: overdueSchedule.initialPercent,
      initialPercent: overdueSchedule.initialPercent,
      numberOfInstallments: 3,
      installmentAmountUsd: overdueSchedule.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: overdue10d,
      installments: overdueSchedule.installments,
      status: 'active',
    });

    // Plan 2: 1 installment -> pay it completely so it becomes completed
    const oneInstSchedule = financeService.calculateCasheaSchedule(100, 3, 1, {
      firstDueDate: addCalendarDays(todayVetIso(), 5),
    });
    const finishedPlan = financeService.registerCasheaPlan({
      productName: 'Audífonos',
      storeName: 'SoyTechno',
      scope: 'personal',
      level: 3,
      creditLine: 'principal',
      totalPriceUsd: 100,
      initialPaymentUsd: oneInstSchedule.initialPaymentUsd,
      initialPercentage: oneInstSchedule.initialPercent,
      initialPercent: oneInstSchedule.initialPercent,
      numberOfInstallments: 1,
      installmentAmountUsd: oneInstSchedule.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: addCalendarDays(todayVetIso(), 5),
      installments: oneInstSchedule.installments,
      status: 'active',
    });
    financeService.markCasheaInstallmentPaid(finishedPlan.id, 1, 'REF-1', undefined, vault.id);
    fixture.detectChanges();

    // Active vs completed split
    expect(component.activePlans().length).toBe(1);
    expect(component.completedPlans().length).toBe(1);

    // Anti-Mora health check for overduePlan
    const health = component.getPlanHealth(overduePlan);
    expect(health?.status).toBe('overdue_penalty');
    expect(health?.reactivationFeeUsd).toBe(4);
    expect(health?.penaltyTier).toBe('7d');
    expect(fixture.nativeElement.textContent as string).toContain('Mora +$4 reactivación');

    // Partial payment (Abonar) on overduePlan's first installment ($40 total -> pay $15)
    component.openPartialPayment(overduePlan);
    component.partialAmountUsd.set(15);
    component.submitPartialPayment(overduePlan);
    const updatedOverdue = financeService.state().casheaPlans.find((p) => p.id === overduePlan.id);
    expect(updatedOverdue?.installments[0].amountPaidUsd).toBe(15);
    expect(updatedOverdue?.installments[0].status).toBe('pending');

    // Delete with reversePayments restores vault balance
    const balanceBeforeDelete = financeService.state().assets.find((v) => v.id === vault.id)!.balance;
    component.reversePaymentsOnDelete.set(true);
    component.deletePlan(overduePlan);
    const balanceAfterDelete = financeService.state().assets.find((v) => v.id === vault.id)!.balance;
    expect(balanceAfterDelete).toBe(balanceBeforeDelete + 15);
    expect(component.activePlans().length).toBe(0);
  });
});
