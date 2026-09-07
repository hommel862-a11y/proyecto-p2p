/**
 * Pure domain logic for P2P High-Volume Capital Allocation & Dynamic Order Limits.
 * Designed for professional multi-account balancing ($10,000 portfolio split)
 * and anti-pitufeo limit structuring in Venezuelan banking.
 */

import { type BankAccount, type BankCode } from './accounts';

export interface DynamicLimitsTier {
  capitalUsdt: number;
  minTicketUsdt: number;
  maxTicketUsdt: number;
  minTicketVes: number;
  maxTicketVes: number;
  antiPitufeoRule: string;
  hourOfDay: number;
  regime: 'MORNING_LIQUIDITY' | 'MIDDAY_VOLATILITY' | 'AFTERNOON_RETAIL' | 'NIGHT_SAME_BANK';
}

export interface BankAllocationWeight {
  bankCode: BankCode;
  recommendedPct: number;    // e.g. 40% Banesco, 35% Mercantil, 25% BDV
  allocatedCapitalUsdt: number;
  allocatedCapitalVes: number;
  maxRecommendedTickets: number;
  priorityRole: string;
}

export interface PortfolioAllocationPlan {
  totalCapitalUsdt: number;
  referenceRateVes: number;
  allocations: BankAllocationWeight[];
  limitsRecommendation: DynamicLimitsTier;
  strategicNotes: string[];
}

/**
 * Computes dynamic order limits according to capital size, time of day and market regime.
 */
export function computeDynamicOrderLimits(
  capitalUsdt: number,
  hourOfDay: number = 10,
  referenceRateVes: number = 60.0,
): DynamicLimitsTier {
  let minTicketUsdt = 150;
  let maxTicketUsdt = Math.min(2500, Math.max(500, capitalUsdt * 0.25));
  let regime: DynamicLimitsTier['regime'] = 'MORNING_LIQUIDITY';

  if (hourOfDay >= 8 && hourOfDay < 12) {
    regime = 'MORNING_LIQUIDITY';
    minTicketUsdt = Math.max(150, capitalUsdt * 0.02);
  } else if (hourOfDay >= 12 && hourOfDay < 15) {
    regime = 'MIDDAY_VOLATILITY';
    // Midday price shift window: shrink max tickets to reduce open exposure
    maxTicketUsdt = Math.min(1500, capitalUsdt * 0.15);
    minTicketUsdt = Math.max(200, capitalUsdt * 0.025);
  } else if (hourOfDay >= 15 && hourOfDay < 19) {
    regime = 'AFTERNOON_RETAIL';
    minTicketUsdt = Math.max(150, capitalUsdt * 0.015);
  } else {
    regime = 'NIGHT_SAME_BANK';
    // Night operations: operate same-bank only with higher minimums
    minTicketUsdt = Math.max(250, capitalUsdt * 0.03);
    maxTicketUsdt = Math.min(2000, capitalUsdt * 0.2);
  }

  const minTicketVes = minTicketUsdt * referenceRateVes;
  const maxTicketVes = maxTicketUsdt * referenceRateVes;

  return {
    capitalUsdt,
    minTicketUsdt: Math.round(minTicketUsdt),
    maxTicketUsdt: Math.round(maxTicketUsdt),
    minTicketVes: Math.round(minTicketVes),
    maxTicketVes: Math.round(maxTicketVes),
    antiPitufeoRule: `Mínimo estricto $${Math.round(minTicketUsdt)} para proteger cupos diarios de Pago Móvil contra órdenes de $5-$10.`,
    hourOfDay,
    regime,
  };
}

/**
 * Distributes capital across Banesco, Mercantil and BDV to prevent quota saturation.
 * Supports custom weight percentages per bank when provided.
 */
export function buildPortfolioAllocationPlan(
  totalCapitalUsdt: number,
  registeredAccounts: readonly BankAccount[] = [],
  referenceRateVes: number = 60.0,
  hourOfDay: number = 10,
  customWeights?: Partial<Record<BankCode, number>>,
): PortfolioAllocationPlan {
  // Institutional target weights for Venezuela P2P (or custom user overrides)
  const defaultWeights: Record<BankCode, { pct: number; role: string }> = {
    BANESCO: { pct: 40, role: 'Cuenta Ancla (Tickets altos $500-$2,500 y transferencias seguras)' },
    MERCANTIL: { pct: 35, role: 'Flujo Intermedio & TPago confiable con bajas tasas de retención' },
    BDV: { pct: 25, role: 'Captación de liquidez rápida minorista (No pernoctar bolívares)' },
    BANCAMIGA: { pct: 0, role: 'Cuenta auxiliar de apoyo' },
    PROVINCIAL: { pct: 0, role: 'Cuenta auxiliar de apoyo' },
    OTRO: { pct: 0, role: 'Cuenta auxiliar' },
  };

  const banescoPct = customWeights?.BANESCO != null ? Math.max(0, customWeights.BANESCO) : defaultWeights.BANESCO.pct;
  const mercantilPct = customWeights?.MERCANTIL != null ? Math.max(0, customWeights.MERCANTIL) : defaultWeights.MERCANTIL.pct;
  const bdvPct = customWeights?.BDV != null ? Math.max(0, customWeights.BDV) : defaultWeights.BDV.pct;

  const allocations: BankAllocationWeight[] = [
    {
      bankCode: 'BANESCO',
      recommendedPct: banescoPct,
      allocatedCapitalUsdt: Math.round((totalCapitalUsdt * banescoPct) / 100),
      allocatedCapitalVes: Math.round(((totalCapitalUsdt * banescoPct) / 100) * referenceRateVes),
      maxRecommendedTickets: 6,
      priorityRole: defaultWeights.BANESCO.role,
    },
    {
      bankCode: 'MERCANTIL',
      recommendedPct: mercantilPct,
      allocatedCapitalUsdt: Math.round((totalCapitalUsdt * mercantilPct) / 100),
      allocatedCapitalVes: Math.round(((totalCapitalUsdt * mercantilPct) / 100) * referenceRateVes),
      maxRecommendedTickets: 6,
      priorityRole: defaultWeights.MERCANTIL.role,
    },
    {
      bankCode: 'BDV',
      recommendedPct: bdvPct,
      allocatedCapitalUsdt: Math.round((totalCapitalUsdt * bdvPct) / 100),
      allocatedCapitalVes: Math.round(((totalCapitalUsdt * bdvPct) / 100) * referenceRateVes),
      maxRecommendedTickets: 4,
      priorityRole: defaultWeights.BDV.role,
    },
  ];

  const limitsRecommendation = computeDynamicOrderLimits(totalCapitalUsdt, hourOfDay, referenceRateVes);

  return {
    totalCapitalUsdt,
    referenceRateVes,
    allocations,
    limitsRecommendation,
    strategicNotes: [
      'Rotar anuncios entre bancos cada vez que una cuenta alcance 10 transferencias en el día.',
      'En horario nocturno (>19:00), restringir anuncios exclusivamente a "Mismo Banco" para evitar retrasos de compensación interbancaria.',
      'Nunca cerrar la jornada después de las 20:00 con bolívares inmovilizados en BDV.',
    ],
  };
}
