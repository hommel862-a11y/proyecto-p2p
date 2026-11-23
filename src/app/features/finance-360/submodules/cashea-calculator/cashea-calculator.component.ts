import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Finance360Service,
  type CasheaCollisionItem,
  type CasheaScheduleBreakdown,
  type CasheaVsSavingsResult,
} from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import {
  CASHEA_CLUB_TIERS,
  CASHEA_CREDIT_LINE,
  addCalendarDays,
  computeTriMonetaryAmount,
  roundMoney,
  todayVetIso,
  type AssetVault,
  type CasheaClubTierMeta,
  type CasheaCreditLine,
  type CasheaInstallment,
  type CasheaInstallmentHealth,
  type CasheaLevel,
  type CasheaPlan,
  type FinanceScope,
} from '../../../../core/models/finance-360.models';

export const CASHEA_INITIAL_MODE = {
  STANDARD: 'standard',
  ZERO_CAMPAIGN: 'zero_campaign',
  CUSTOM: 'custom',
} as const;
export type CasheaInitialMode =
  (typeof CASHEA_INITIAL_MODE)[keyof typeof CASHEA_INITIAL_MODE];

export interface CasheaLineOption {
  readonly key: CasheaCreditLine;
  readonly label: string;
  readonly subtitle: string;
}

export interface CasheaProjectedDateItem {
  number: number;
  dateStr: string;
  amountUsd: number;
  amountVes: number;
  collision: CasheaCollisionItem | null;
}

export interface CasheaCalculationView extends CasheaScheduleBreakdown {
  initialVes: number;
  installmentVes: number;
  totalVes: number;
  bcvRate: number;
}

export interface CasheaProfileSummary {
  level: CasheaLevel;
  tierName: string;
  principalLimitUsd: number;
  principalUsedUsd: number;
  principalAvailableUsd: number;
  principalUsagePct: number;
  cotidianaLimitUsd: number;
  cotidianaUsedUsd: number;
  cotidianaAvailableUsd: number;
  cotidianaUsagePct: number;
  cumulativeSpentUsd: number;
  paidInstallmentsCount: number;
  clubPoints: number;
  nextRecalculationDate: string;
  nextTier: CasheaClubTierMeta | null;
  spentProgressPct: number;
  installmentsProgressPct: number;
}

export interface CasheaAntiMoraBadge {
  label: string;
  tone: 'optimal' | 'warning' | 'danger' | 'neutral';
  penaltyTierLabel: string | null;
  clubPointsImpact: string;
  reactivationFeeUsd: number;
}

export const CASHEA_LINE_OPTIONS: readonly CasheaLineOption[] = [
  {
    key: CASHEA_CREDIT_LINE.PRINCIPAL,
    label: 'Línea Principal',
    subtitle: 'Comercios aliados · 14D',
  },
  {
    key: CASHEA_CREDIT_LINE.COTIDIANA,
    label: 'Línea Cotidiana',
    subtitle: 'Supermercados y farmacias · 14D',
  },
  {
    key: CASHEA_CREDIT_LINE.VEHICULAR,
    label: 'Crédito Vehicular 12–24m',
    subtitle: 'Cuotas mensuales · 30D',
  },
];

const STANDARD_INSTALLMENT_OPTIONS: readonly number[] = [1, 3, 6, 9, 12];
const VEHICULAR_INSTALLMENT_OPTIONS: readonly number[] = [12, 18, 24];

@Component({
  selector: 'app-cashea-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cashea-calculator.component.html',
  styleUrls: ['./cashea-calculator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CasheaCalculatorComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);

  readonly privacyMode = input<boolean>(false);

  readonly clubTiers: readonly CasheaClubTierMeta[] = [1, 2, 3, 4, 5, 6].map(
    (lvl) => CASHEA_CLUB_TIERS[lvl as CasheaLevel],
  );
  readonly lineOptions = CASHEA_LINE_OPTIONS;

  // Simulator Form State
  readonly itemTitle = signal<string>('');
  readonly storeName = signal<string>('');
  readonly totalAmountUsd = signal<number | null>(150);
  readonly selectedLevel = signal<CasheaLevel>(3);
  readonly selectedCreditLine = signal<CasheaCreditLine>(CASHEA_CREDIT_LINE.PRINCIPAL);
  readonly totalInstallments = signal<number>(3);
  readonly initialMode = signal<CasheaInitialMode>(CASHEA_INITIAL_MODE.STANDARD);
  readonly customInitialPercent = signal<number>(40);
  readonly firstDueDate = signal<string>(addCalendarDays(todayVetIso(), 14));
  readonly paymentReference = signal<string>('');
  readonly debitInitialFromVault = signal<boolean>(true);

  // Dual Projector State
  readonly biweeklySavingsCapacityUsd = signal<number>(120);
  readonly expectedBiweeklyInflationPct = signal<number>(0);

  // Profile Inline Editor State
  readonly showProfileEditor = signal<boolean>(false);
  readonly profileDraftLevel = signal<CasheaLevel>(1);
  readonly profileDraftPrincipalLimit = signal<number>(0);
  readonly profileDraftCotidianaLimit = signal<number>(0);
  readonly profileDraftSpentUsd = signal<number>(0);
  readonly profileDraftPaidCount = signal<number>(0);
  readonly profileDraftClubPoints = signal<number>(0);

  // Plan Card Interactive Overlays
  readonly activePartialPlanId = signal<string | null>(null);
  readonly partialAmountUsd = signal<number | null>(null);
  readonly openMenuPlanId = signal<string | null>(null);
  readonly reversePaymentsOnDelete = signal<boolean>(false);
  readonly showCompletedPlans = signal<boolean>(false);

  // Live FX & Vaults
  readonly isBcvLive = computed<boolean>(() => this.financeService.isBcvRateLive());
  readonly availableVaults = computed<readonly AssetVault[]>(() => this.financeService.state().assets);

  readonly selectedPaymentVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.availableVaults,
    computation: (vaults, previous) => {
      if (previous?.value && vaults.some((v) => v.id === previous.value)) {
        return previous.value;
      }
      return vaults[0]?.id ?? '';
    },
  });

  readonly activeTierMeta = computed<CasheaClubTierMeta>(
    () => CASHEA_CLUB_TIERS[this.selectedLevel()] ?? CASHEA_CLUB_TIERS[3],
  );

  readonly availableInstallmentOptions = computed<readonly number[]>(() =>
    this.selectedCreditLine() === CASHEA_CREDIT_LINE.VEHICULAR
      ? VEHICULAR_INSTALLMENT_OPTIONS
      : STANDARD_INSTALLMENT_OPTIONS,
  );

  readonly standardInitialPercent = computed<number>(() => {
    const tier = this.activeTierMeta();
    return this.selectedCreditLine() === CASHEA_CREDIT_LINE.COTIDIANA
      ? tier.cotidianaInitialPercent
      : tier.principalInitialPercent;
  });

  readonly canUseZeroCampaign = computed<boolean>(
    () =>
      this.selectedLevel() === 6 &&
      this.selectedCreditLine() === CASHEA_CREDIT_LINE.PRINCIPAL,
  );

  readonly minimumInitialPercent = computed<number>(() => {
    if (this.canUseZeroCampaign()) return 0;
    return this.standardInitialPercent();
  });

  readonly zeroInitialCampaign = computed<boolean>(
    () =>
      this.canUseZeroCampaign() &&
      this.initialMode() === CASHEA_INITIAL_MODE.ZERO_CAMPAIGN,
  );

  readonly effectiveCustomInitialPercent = computed<number | undefined>(() => {
    if (this.initialMode() !== CASHEA_INITIAL_MODE.CUSTOM) return undefined;
    const minPct = this.minimumInitialPercent();
    const raw = this.customInitialPercent();
    const safe = Number.isFinite(raw) ? raw : minPct;
    return Math.max(minPct, Math.min(90, roundMoney(safe, 2)));
  });

  /** Real-time schedule calculation using v2 engine */
  readonly calculation = computed<CasheaCalculationView>(() => {
    const total = Math.max(0, Number(this.totalAmountUsd() ?? 0));
    const level = this.selectedLevel();
    const count = this.totalInstallments();
    const creditLine = this.selectedCreditLine();
    const bcv = this.financeService.currentBcvRate();
    const frequencyDays = creditLine === CASHEA_CREDIT_LINE.VEHICULAR ? 30 : 14;

    const result = this.financeService.calculateCasheaSchedule(total, level, count, {
      creditLine,
      firstDueDate: this.firstDueDate() || addCalendarDays(todayVetIso(), frequencyDays),
      initialPercent: this.effectiveCustomInitialPercent(),
      zeroInitialCampaign: this.zeroInitialCampaign(),
      frequencyDays,
    });

    return {
      ...result,
      initialVes: bcv > 0 ? roundMoney(result.initialPaymentUsd * bcv) : 0,
      installmentVes: bcv > 0 ? roundMoney(result.installmentAmountUsd * bcv) : 0,
      totalVes: bcv > 0 ? roundMoney(total * bcv) : 0,
      bcvRate: bcv,
    };
  });

  /** 14D Biweekly Collision Detection against existing liabilities and active recurring rules */
  readonly collisions14D = computed<CasheaCollisionItem[]>(() => {
    const dueDates = this.calculation().installments.map((inst) => inst.dueDate);
    return this.financeService.detectCasheaCollisions14D(dueDates);
  });

  readonly totalCollisionEvents = computed<number>(() =>
    this.collisions14D().reduce((sum, item) => sum + item.collisionCount, 0),
  );

  /** Projected Due Dates derived 1:1 from engine installments + collision telemetry */
  readonly projectedDates = computed<CasheaProjectedDateItem[]>(() => {
    const calc = this.calculation();
    const bcv = calc.bcvRate;
    const collisionByDate = new Map(this.collisions14D().map((c) => [c.date, c]));

    return calc.installments.map((inst) => ({
      number: inst.number,
      dateStr: inst.dueDate,
      amountUsd: inst.amountUsd,
      amountVes: bcv > 0 ? roundMoney(inst.amountUsd * bcv) : 0,
      collision: collisionByDate.get(inst.dueDate) ?? null,
    }));
  });

  /** Dual Projector: Path A (Cash Savings) vs Path B (Financed Cashea) */
  readonly dualProjection = computed<CasheaVsSavingsResult>(() => {
    const total = Math.max(0, Number(this.totalAmountUsd() ?? 0));
    const capacity = Math.max(0, Number(this.biweeklySavingsCapacityUsd() || 0));
    const inflation = Math.max(0, Number(this.expectedBiweeklyInflationPct() || 0));

    return this.financeService.simulateCasheaVsSavings({
      productPriceUsd: total,
      level: this.selectedLevel(),
      installmentsCount: this.totalInstallments(),
      biweeklySavingsCapacityUsd: capacity,
      creditLine: this.selectedCreditLine(),
      initialPercent: this.effectiveCustomInitialPercent(),
      expectedBiweeklyInflationPct: inflation,
      bcvRate: this.financeService.currentBcvRate(),
      firstDueDate: this.firstDueDate(),
      zeroInitialCampaign: this.zeroInitialCampaign(),
    });
  });

  /** Club Cashea Más Profile Strip Telemetry */
  readonly profileSummary = computed<CasheaProfileSummary>(() => {
    const profile = this.financeService.casheaProfile();
    const tier = CASHEA_CLUB_TIERS[profile.level] ?? CASHEA_CLUB_TIERS[1];
    const nextTierLevel = profile.level < 6 ? ((profile.level + 1) as CasheaLevel) : null;
    const nextTier = nextTierLevel ? CASHEA_CLUB_TIERS[nextTierLevel] : null;

    const principalAvailableUsd = Math.max(
      0,
      roundMoney(profile.principalLimitUsd - profile.principalUsedUsd),
    );
    const cotidianaAvailableUsd = Math.max(
      0,
      roundMoney(profile.cotidianaLimitUsd - profile.cotidianaUsedUsd),
    );

    const principalUsagePct =
      profile.principalLimitUsd > 0
        ? Math.min(100, Math.round((profile.principalUsedUsd / profile.principalLimitUsd) * 100))
        : 0;
    const cotidianaUsagePct =
      profile.cotidianaLimitUsd > 0
        ? Math.min(100, Math.round((profile.cotidianaUsedUsd / profile.cotidianaLimitUsd) * 100))
        : 0;

    const spentProgressPct = nextTier
      ? Math.min(100, Math.round((profile.cumulativeSpentUsd / nextTier.requiredSpentUsd) * 100))
      : 100;
    const installmentsProgressPct = nextTier
      ? Math.min(
          100,
          Math.round((profile.paidInstallmentsCount / nextTier.requiredInstallmentsPaid) * 100),
        )
      : 100;

    return {
      level: profile.level,
      tierName: tier.name,
      principalLimitUsd: profile.principalLimitUsd,
      principalUsedUsd: profile.principalUsedUsd,
      principalAvailableUsd,
      principalUsagePct,
      cotidianaLimitUsd: profile.cotidianaLimitUsd,
      cotidianaUsedUsd: profile.cotidianaUsedUsd,
      cotidianaAvailableUsd,
      cotidianaUsagePct,
      cumulativeSpentUsd: profile.cumulativeSpentUsd,
      paidInstallmentsCount: profile.paidInstallmentsCount,
      clubPoints: profile.clubPoints ?? 0,
      nextRecalculationDate: profile.nextRecalculationDate ?? addCalendarDays(todayVetIso(), 90),
      nextTier,
      spentProgressPct,
      installmentsProgressPct,
    };
  });

  /** Strictly Active Plans vs Completed Plans */
  readonly activePlans = computed<CasheaPlan[]>(() =>
    this.financeService.state().casheaPlans.filter((p) => p.status === 'active'),
  );

  readonly completedPlans = computed<CasheaPlan[]>(() =>
    this.financeService.state().casheaPlans.filter((p) => p.status === 'completed'),
  );

  setLevel(level: CasheaLevel): void {
    this.selectedLevel.set(level);
    if (level !== 6 && this.initialMode() === CASHEA_INITIAL_MODE.ZERO_CAMPAIGN) {
      this.initialMode.set(CASHEA_INITIAL_MODE.STANDARD);
    }
    const minPct = this.minimumInitialPercent();
    if (this.customInitialPercent() < minPct) {
      this.customInitialPercent.set(minPct);
    }
  }

  setCreditLine(line: CasheaCreditLine): void {
    this.selectedCreditLine.set(line);
    if (line === CASHEA_CREDIT_LINE.VEHICULAR) {
      if (!VEHICULAR_INSTALLMENT_OPTIONS.includes(this.totalInstallments())) {
        this.totalInstallments.set(12);
      }
      this.firstDueDate.set(addCalendarDays(todayVetIso(), 30));
    } else {
      if (!STANDARD_INSTALLMENT_OPTIONS.includes(this.totalInstallments())) {
        this.totalInstallments.set(3);
      }
    }

    if (line !== CASHEA_CREDIT_LINE.PRINCIPAL && this.initialMode() === CASHEA_INITIAL_MODE.ZERO_CAMPAIGN) {
      this.initialMode.set(CASHEA_INITIAL_MODE.STANDARD);
    }
    const minPct = this.minimumInitialPercent();
    if (this.customInitialPercent() < minPct) {
      this.customInitialPercent.set(minPct);
    }
  }

  setInstallments(count: number): void {
    const safeCount = Math.trunc(Number(count));
    if (!Number.isFinite(safeCount) || safeCount <= 0) return;
    this.totalInstallments.set(safeCount);
  }

  useStandardInitial(): void {
    this.initialMode.set(CASHEA_INITIAL_MODE.STANDARD);
    this.customInitialPercent.set(this.standardInitialPercent());
  }

  enableZeroInitialCampaign(): void {
    if (!this.canUseZeroCampaign()) return;
    this.initialMode.set(CASHEA_INITIAL_MODE.ZERO_CAMPAIGN);
  }

  enableCustomInitial(): void {
    this.initialMode.set(CASHEA_INITIAL_MODE.CUSTOM);
    const minPct = this.minimumInitialPercent();
    if (this.customInitialPercent() < minPct) {
      this.customInitialPercent.set(minPct);
    }
  }

  setCustomInitialPercent(rawValue: number | string): void {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    const minPct = this.minimumInitialPercent();
    const clamped = Math.max(minPct, Math.min(90, roundMoney(numeric, 1)));
    this.initialMode.set(CASHEA_INITIAL_MODE.CUSTOM);
    this.customInitialPercent.set(clamped);
  }

  onTotalAmountChange(rawValue: number | string | null): void {
    if (rawValue === null || rawValue === '') {
      this.totalAmountUsd.set(null);
      return;
    }
    const numeric = Number(rawValue);
    this.totalAmountUsd.set(Number.isFinite(numeric) ? numeric : null);
  }

  onBiweeklySavingsChange(rawValue: number | string): void {
    const numeric = Number(rawValue);
    this.biweeklySavingsCapacityUsd.set(Number.isFinite(numeric) && numeric >= 0 ? numeric : 0);
  }

  onInflationChange(rawValue: number | string): void {
    const numeric = Number(rawValue);
    this.expectedBiweeklyInflationPct.set(Number.isFinite(numeric) && numeric >= 0 ? numeric : 0);
  }

  isInstallmentSupportedByTier(count: number): boolean {
    if (this.selectedCreditLine() === CASHEA_CREDIT_LINE.VEHICULAR) return true;
    return this.activeTierMeta().supportedInstallments.includes(count);
  }

  getTierSubtitle(tier: CasheaClubTierMeta): string {
    if (tier.campaignInitialPercent === 0) {
      return `${tier.principalInitialPercent}% / ${tier.cotidianaInitialPercent}% · 0%`;
    }
    if (tier.principalInitialPercent === tier.cotidianaInitialPercent) {
      return `${tier.principalInitialPercent}% Inicial`;
    }
    return `${tier.principalInitialPercent}% / ${tier.cotidianaInitialPercent}%`;
  }

  openProfileEditor(): void {
    const current = this.financeService.casheaProfile();
    this.profileDraftLevel.set(current.level);
    this.profileDraftPrincipalLimit.set(current.principalLimitUsd);
    this.profileDraftCotidianaLimit.set(current.cotidianaLimitUsd);
    this.profileDraftSpentUsd.set(current.cumulativeSpentUsd);
    this.profileDraftPaidCount.set(current.paidInstallmentsCount);
    this.profileDraftClubPoints.set(current.clubPoints ?? 0);
    this.showProfileEditor.set(true);
  }

  onProfileDraftLevelChange(raw: number | string): void {
    const num = Math.max(1, Math.min(6, Math.trunc(Number(raw) || 1)));
    this.profileDraftLevel.set(num as CasheaLevel);
  }

  onNumericDraftChange(target: 'principal' | 'cotidiana' | 'spent' | 'paid' | 'points' | 'partial', raw: number | string): void {
    const num = Number(raw);
    const safe = Number.isFinite(num) && num >= 0 ? num : 0;
    if (target === 'principal') this.profileDraftPrincipalLimit.set(safe);
    else if (target === 'cotidiana') this.profileDraftCotidianaLimit.set(safe);
    else if (target === 'spent') this.profileDraftSpentUsd.set(safe);
    else if (target === 'paid') this.profileDraftPaidCount.set(Math.trunc(safe));
    else if (target === 'points') this.profileDraftClubPoints.set(Math.trunc(safe));
    else this.partialAmountUsd.set(safe);
  }

  closeProfileEditor(): void {
    this.showProfileEditor.set(false);
  }

  saveProfileEditor(): void {
    const nextLevel = this.profileDraftLevel();
    this.financeService.updateCasheaProfile({
      level: nextLevel,
      principalLimitUsd: Math.max(0, roundMoney(Number(this.profileDraftPrincipalLimit()) || 0)),
      cotidianaLimitUsd: Math.max(0, roundMoney(Number(this.profileDraftCotidianaLimit()) || 0)),
      cumulativeSpentUsd: Math.max(0, roundMoney(Number(this.profileDraftSpentUsd()) || 0)),
      paidInstallmentsCount: Math.max(0, Math.trunc(Number(this.profileDraftPaidCount()) || 0)),
      clubPoints: Math.max(0, Math.trunc(Number(this.profileDraftClubPoints()) || 0)),
    });
    this.setLevel(nextLevel);
    this.showProfileEditor.set(false);
    this.toast.success('Perfil Club Cashea Más actualizado.');
  }

  savePlan(): void {
    const title = this.itemTitle().trim() || 'Compra Cashea';
    const store = this.storeName().trim() || 'Comercio Cashea';
    const total = this.totalAmountUsd();

    if (!total || !Number.isFinite(total) || total <= 0) {
      this.toast.warn('Ingresa un monto válido para la compra.');
      return;
    }

    const calc = this.calculation();
    const activeScope = this.financeService.scope();
    const planScope: FinanceScope = activeScope === 'business' ? 'business' : 'personal';
    const vaultId = this.selectedPaymentVaultId() || undefined;
    const vault = vaultId
      ? this.financeService.state().assets.find((v) => v.id === vaultId)
      : undefined;

    let initialExpenseId: string | undefined;
    if (this.debitInitialFromVault() && calc.initialPaymentUsd > 0 && vault) {
      const bcv = this.financeService.currentBcvRate();
      const parallel = this.financeService.currentParallelRate();
      const initialExpense = this.financeService.addExpense({
        title: `Inicial Cashea (${calc.initialPercent}%): ${title}`,
        scope: planScope,
        category: 'cashea_installment',
        channel: vault.channel,
        vaultId: vault.id,
        casheaLine: calc.creditLine,
        triMonetary: computeTriMonetaryAmount(calc.initialPaymentUsd, 'USD', bcv, parallel),
        date: todayVetIso(),
        notes: `Pago inicial en ${store} · Nivel ${calc.level} ${calc.tierName}`,
      });
      initialExpenseId = initialExpense.id;
    }

    const plan = this.financeService.registerCasheaPlan({
      productName: title,
      storeName: store,
      scope: planScope,
      level: calc.level,
      creditLine: calc.creditLine,
      totalPriceUsd: roundMoney(total),
      initialPaymentUsd: calc.initialPaymentUsd,
      initialPercentage: calc.initialPercent,
      initialPercent: calc.initialPercent,
      initialExpenseId,
      initialVaultId: initialExpenseId ? vault?.id : undefined,
      numberOfInstallments: calc.installmentsCount,
      installmentAmountUsd: calc.installmentAmountUsd,
      installmentFrequencyDays: calc.frequencyDays,
      startDate: this.firstDueDate() || calc.installments[0]?.dueDate || todayVetIso(),
      installments: calc.installments,
      status: 'active',
    });

    this.toast.success(
      `Plan "${plan.productName}" registrado con ${plan.numberOfInstallments} cuotas programadas en Pasivos.`,
    );

    this.itemTitle.set('');
    this.storeName.set('');
    this.totalAmountUsd.set(150);
  }

  getNextPendingInstallment(plan: CasheaPlan): CasheaInstallment | null {
    return plan.installments.find((inst) => inst.status !== 'paid') ?? null;
  }

  getRemainingInstallmentUsd(inst: CasheaInstallment): number {
    return Math.max(0, roundMoney(inst.amountUsd - (inst.amountPaidUsd ?? 0)));
  }

  getInstallmentVes(amountUsd: number): number {
    const bcv = this.financeService.currentBcvRate();
    return bcv > 0 ? roundMoney(amountUsd * bcv) : 0;
  }

  getPlanHealth(plan: CasheaPlan): CasheaInstallmentHealth | null {
    const nextInst = this.getNextPendingInstallment(plan);
    if (!nextInst) return null;
    return this.financeService.evaluateCasheaInstallmentHealth(nextInst.dueDate, nextInst.status);
  }

  getAntiMoraBadge(plan: CasheaPlan): CasheaAntiMoraBadge {
    const health = this.getPlanHealth(plan);
    if (!health) {
      return {
        label: 'Completado',
        tone: 'optimal',
        penaltyTierLabel: null,
        clubPointsImpact: 'Plan saldado al 100%',
        reactivationFeeUsd: 0,
      };
    }

    if (health.status === 'overdue_penalty') {
      const penaltyTierLabel =
        health.penaltyTier !== 'none' ? `Penalización ${health.penaltyTier}` : null;
      return {
        label: `Mora +$${health.reactivationFeeUsd} reactivación`,
        tone: 'danger',
        penaltyTierLabel,
        clubPointsImpact: health.clubPointsImpact,
        reactivationFeeUsd: health.reactivationFeeUsd,
      };
    }

    if (health.status === 'grace_2d') {
      return {
        label: 'En gracia (2D)',
        tone: 'warning',
        penaltyTierLabel: null,
        clubPointsImpact: health.clubPointsImpact,
        reactivationFeeUsd: 0,
      };
    }

    if (health.status === 'due_soon_48h') {
      return {
        label: 'Vence <48h',
        tone: 'warning',
        penaltyTierLabel: null,
        clubPointsImpact: health.clubPointsImpact,
        reactivationFeeUsd: 0,
      };
    }

    return {
      label: 'Al día',
      tone: 'optimal',
      penaltyTierLabel: null,
      clubPointsImpact: health.clubPointsImpact,
      reactivationFeeUsd: 0,
    };
  }

  getInstallmentDotState(inst: CasheaInstallment): 'paid' | 'partial' | 'warning' | 'danger' | 'pending' {
    if (inst.status === 'paid') return 'paid';
    const health = this.financeService.evaluateCasheaInstallmentHealth(inst.dueDate, inst.status);
    if (health.status === 'overdue_penalty') return 'danger';
    if (health.status === 'grace_2d' || health.status === 'due_soon_48h') return 'warning';
    if ((inst.amountPaidUsd ?? 0) > 0) return 'partial';
    return 'pending';
  }

  payNextInstallment(plan: CasheaPlan): void {
    const pendingInst = this.getNextPendingInstallment(plan);
    if (!pendingInst) {
      this.toast.info('Este plan ya está cancelado al 100%.');
      return;
    }

    const vaultId = this.selectedPaymentVaultId() || undefined;
    const ref = this.paymentReference().trim() || undefined;
    const result = this.financeService.markCasheaInstallmentPaid(
      plan.id,
      pendingInst.number,
      ref,
      undefined,
      vaultId,
    );

    if (!result.success) {
      this.toast.warn('No fue posible liquidar esta cuota.');
      return;
    }

    this.paymentReference.set('');
    this.activePartialPlanId.set(null);
    const vaultName =
      this.financeService.state().assets.find((v) => v.id === vaultId)?.name ??
      'Registro Contable';
    this.toast.success(
      `Cuota #${pendingInst.number} de "${plan.productName}" liquidada desde "${vaultName}".`,
    );
  }

  openPartialPayment(plan: CasheaPlan): void {
    const nextInst = this.getNextPendingInstallment(plan);
    if (!nextInst) return;
    if (this.activePartialPlanId() === plan.id) {
      this.activePartialPlanId.set(null);
      return;
    }
    const remaining = this.getRemainingInstallmentUsd(nextInst);
    this.activePartialPlanId.set(plan.id);
    this.partialAmountUsd.set(roundMoney(remaining / 2));
    this.openMenuPlanId.set(null);
  }

  submitPartialPayment(plan: CasheaPlan): void {
    const nextInst = this.getNextPendingInstallment(plan);
    const amount = Number(this.partialAmountUsd() ?? 0);
    if (!nextInst || !Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingresa un monto de abono mayor a $0.');
      return;
    }

    const vaultId = this.selectedPaymentVaultId() || undefined;
    const ref = this.paymentReference().trim() || undefined;
    const res = this.financeService.recordCasheaPartialPayment(
      plan.id,
      nextInst.number,
      amount,
      ref,
      vaultId,
    );

    if (!res.success) {
      this.toast.warn('No se pudo registrar el abono parcial.');
      return;
    }

    this.activePartialPlanId.set(null);
    this.partialAmountUsd.set(null);
    this.paymentReference.set('');
    this.toast.success(
      `Abono de $${res.paidAmountUsd.toFixed(2)} USD aplicado a cuota #${nextInst.number}.`,
    );
  }

  togglePlanMenu(planId: string): void {
    if (this.openMenuPlanId() === planId) {
      this.openMenuPlanId.set(null);
    } else {
      this.openMenuPlanId.set(planId);
      this.activePartialPlanId.set(null);
    }
  }

  deletePlan(plan: CasheaPlan): void {
    const reversePayments = this.reversePaymentsOnDelete();
    this.financeService.deleteCasheaPlan(plan.id, { reversePayments });
    this.openMenuPlanId.set(null);
    this.reversePaymentsOnDelete.set(false);
    this.toast.info(
      reversePayments
        ? `Plan "${plan.productName}" eliminado y pagos revertidos a bóvedas.`
        : `Plan "${plan.productName}" y sus cuotas asociadas eliminados.`,
    );
  }

  getPaidCount(plan: CasheaPlan): number {
    return plan.installments.filter((i) => i.status === 'paid').length;
  }

  getPlanLineLabel(line?: CasheaCreditLine): string {
    if (line === CASHEA_CREDIT_LINE.COTIDIANA) return 'Línea Cotidiana';
    if (line === CASHEA_CREDIT_LINE.VEHICULAR) return 'Crédito Vehicular';
    return 'Línea Principal';
  }

  getRecommendationLabel(rec: CasheaVsSavingsResult['recommendation']): string {
    if (rec === 'cashea_viable') return 'Cashea Viable · 0% Interés';
    if (rec === 'stretch_warning') return 'Flujo Ajustado · Precaución';
    return 'Ahorro Programado Recomendado';
  }

  formatUsd(amount: number): string {
    if (this.privacyMode()) return '••••';
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  formatVes(amount: number): string {
    if (this.privacyMode()) return '••••';
    return `Bs ${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
