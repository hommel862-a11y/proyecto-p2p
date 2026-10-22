/**
 * @file client-compliance-intelligence.ts
 * @description Pure domain engine for Financial CRM, Dynamic Kanban Treasury Pipeline,
 * Bank Shield Capacity Reservation, and Decoupled Dual-Ledger Bridge.
 *
 * Architecture: Hexagonal / Clean Architecture.
 * Standard: 100% pure TypeScript, zero Angular/DOM dependencies, fully deterministic.
 */

// =============================================================================
// 1. DOMAIN MODELS & ENUMS
// =============================================================================

export type WorkspaceScope = 'P2P_DESK' | 'FINANCE_360';

export type PipelineStage =
  | 'STAGE_1_NEW'     // Quoted / Presupuestado
  | 'STAGE_2_TRANSIT' // En Tránsito - Reserva Cupo Banco
  | 'STAGE_3_VERIFY'  // Verificando Ref / Abono Parcial
  | 'STAGE_4_CLOSED'; // Cerrado / Liquidado

export type FiatCurrency = 'VES' | 'COP' | 'USD';

export type CrmContactCategory =
  | 'CLIENT_P2P'
  | 'VIP_OTC'
  | 'SUPPLIER_360'
  | 'CLIENT_360';

export type BankBurstStatus =
  | 'AVAILABLE'
  | 'COOLDOWN_BURST'
  | 'DAILY_CAP_REACHED';

export type ActivityType =
  | 'DEAL_CREATED'
  | 'STAGE_MOVED'
  | 'DEAL_CLOSED'
  | 'BANK_RECONCILED'
  | 'BALANCE_ADJUSTED'
  | 'EXPOSURE_ALERT';

export interface DealTimelineEvent {
  timestamp: number;
  fromStage: PipelineStage | null;
  toStage: PipelineStage;
  notes: string;
}

export interface PipelineDeal {
  id: string;
  scope: WorkspaceScope;
  title: string;
  contactId: string;
  contactName: string;
  bankAccountId: string;
  bankName: string;
  stage: PipelineStage;
  fiatCurrency: FiatCurrency;
  cryptoAmountUsdt: number;
  appliedRate: number;
  replacementRate: number;
  totalFiatAmount: number;
  paidFiatAmount: number;
  netProfitUsdt: number;
  bankReferenceId: string;
  quoteTtlMinutes: number;
  quotedAt: number;
  isRateExpired: boolean;
  timeline: DealTimelineEvent[];
  createdAt: number;
  closedAt: number | null;
}

export interface CrmContact {
  id: string;
  scope: WorkspaceScope;
  name: string;
  documentId: string;
  phoneOrContact: string;
  category: CrmContactCategory;
  paymentDetailsText: string;
  creditLimitUsdt: number;
  /**
   * Positive value (> 0) = Saldo a favor del cliente.
   * Negative value (< 0) = Cuenta por cobrar al cliente.
   */
  pendingBalanceUsdt: number;
  maxPendingExposureUsdt: number;
  isDebtIndexedToUsdt: boolean;
  verifiedReferences: string[];
  createdAt: number;
}

export interface CrmBankAccount {
  id: string;
  scope: WorkspaceScope;
  bankName: string;
  currency: FiatCurrency;
  holderDetailsText: string;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  feePct: number;
  maxBurstTxPer15Min: number;
}

export interface ActivityLogEntry {
  id: string;
  scope: WorkspaceScope;
  timestamp: number;
  type: ActivityType;
  description: string;
  amountUsdt: number;
  referenceId?: string;
}

export interface BankLiveTelemetry {
  bankAccountId: string;
  bankName: string;
  currency: FiatCurrency;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  dailyClosedFiat: number;
  dailyInTransitFiat: number;
  dailyTotalUsedFiat: number;
  dailyUsagePct: number;
  recent15MinTxCount: number;
  maxBurstTxPer15Min: number;
  status: BankBurstStatus;
  isRecommended: boolean;
}

export interface CompiledDeskKpis {
  closedNetProfitTodayUsdt: number;
  closedVolumeTodayUsdt: number;
  inTransitVolumeUsdt: number;
  totalReceivablesUsdt: number;
  totalPayablesUsdt: number;
  spreadEfficiencyPct: number;
  closedTradesCountToday: number;
}

export interface KanbanColumn {
  stage: PipelineStage;
  label: string;
  deals: PipelineDeal[];
  totalUsdt: number;
  totalFiat: number;
}

export interface CompiledCrmWorkspaceState {
  activeScope: WorkspaceScope;
  deals: PipelineDeal[];
  kanbanColumns: Record<PipelineStage, KanbanColumn>;
  kpis: CompiledDeskKpis;
  svgPath: string;
  bankTelemetry: BankLiveTelemetry[];
  recommendedBankId: string | null;
  contacts: CrmContact[];
  activities: ActivityLogEntry[];
}

export interface DailyNetProfitTransferPayload {
  settlementId: string; // Formato SETTLE-YYYY-MM-DD
  dateIso: string;
  netProfitUsdt: number;
  tradesCount: number;
  timestamp: number;
}

export interface ClipboardParseResult {
  detectedBank: string | null;
  referenceId: string | null;
  amountFiat: number | null;
  currency: FiatCurrency | null;
  rawText: string;
}

export interface DirectCommercialQuote {
  totalFiatToCollect: number;
  netProfitUsdt: number;
  marginPct: number;
}

export interface ReferenceCollisionCheck {
  isDuplicate: boolean;
  existingDeal: PipelineDeal | null;
}

// =============================================================================
// 2. STAGE LABELS & CONSTANTS
// =============================================================================

export const STAGE_CONFIG: Record<
  WorkspaceScope,
  Record<PipelineStage, { label: string; description: string }>
> = {
  P2P_DESK: {
    STAGE_1_NEW: {
      label: 'Cotizado / Nuevo',
      description: 'Acuerdo preliminar con cliente fijando tasa y monto.',
    },
    STAGE_2_TRANSIT: {
      label: 'En Tránsito',
      description: 'Pago en camino. Reserva cupo preventivo en banco.',
    },
    STAGE_3_VERIFY: {
      label: 'Verificando Ref',
      description: 'Comprobante recibido. Validación de compensación.',
    },
    STAGE_4_CLOSED: {
      label: 'Liquidado / Cerrado',
      description: 'Operación conciliada con éxito. Suma a balance.',
    },
  },
  FINANCE_360: {
    STAGE_1_NEW: {
      label: 'Presupuesto / Por Pagar',
      description: 'Gasto, servicio o cuenta planificada.',
    },
    STAGE_2_TRANSIT: {
      label: 'En Curso',
      description: 'Proceso de pago iniciado con banco o proveedor.',
    },
    STAGE_3_VERIFY: {
      label: 'Abono Parcial',
      description: 'Pago parcial asentado pendiente de liquidar saldo.',
    },
    STAGE_4_CLOSED: {
      label: 'Pagado / Conciliado',
      description: 'Obligación o cobro liquidado en libro mayor.',
    },
  },
};

// =============================================================================
// 3. PURE BUSINESS FUNCTIONS
// =============================================================================

/**
 * Normalizes reference IDs by trimming whitespace and converting to uppercase.
 */
export function normalizeBankReference(ref: string | null | undefined): string {
  if (!ref) return '';
  return ref.trim().toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Validates whether a candidate reference is already present in another deal.
 */
export function verifyReferenceCollision(
  deals: PipelineDeal[],
  candidateRef: string,
  excludeDealId?: string,
): ReferenceCollisionCheck {
  const normCandidate = normalizeBankReference(candidateRef);
  if (!normCandidate || normCandidate.length < 4) {
    return { isDuplicate: false, existingDeal: null };
  }

  const found = deals.find(
    (d) =>
      d.id !== excludeDealId &&
      normalizeBankReference(d.bankReferenceId) === normCandidate,
  );

  return {
    isDuplicate: Boolean(found),
    existingDeal: found ?? null,
  };
}

/**
 * Evaluates whether adding a new deal exceeds the counterparty pending exposure limit.
 */
export function checkCounterpartyExposure(
  contact: CrmContact,
  existingDeals: PipelineDeal[],
  newDealAmountUsdt: number,
): { allowed: boolean; currentExposureUsdt: number; limitUsdt: number } {
  const activeStages: PipelineStage[] = ['STAGE_2_TRANSIT', 'STAGE_3_VERIFY'];
  const currentExposure = existingDeals
    .filter((d) => d.contactId === contact.id && activeStages.includes(d.stage))
    .reduce((acc, d) => acc + d.cryptoAmountUsdt, 0);

  const totalProjected = currentExposure + newDealAmountUsdt;
  const limit = contact.maxPendingExposureUsdt > 0 ? contact.maxPendingExposureUsdt : 10000;

  return {
    allowed: totalProjected <= limit,
    currentExposureUsdt: Math.round(currentExposure * 100) / 100,
    limitUsdt: limit,
  };
}

/**
 * Direct commercial quote calculator without BPS jargon.
 */
export function calculateDirectQuote(
  amountUsdt: number,
  replacementRate: number,
  offeredRate: number,
  bankFeePct: number,
): DirectCommercialQuote {
  if (amountUsdt <= 0 || offeredRate <= 0) {
    return { totalFiatToCollect: 0, netProfitUsdt: 0, marginPct: 0 };
  }

  const totalFiat = Math.round(amountUsdt * offeredRate * 100) / 100;
  const feeFiat = Math.round(totalFiat * (bankFeePct / 100) * 100) / 100;
  const netFiatProfit = totalFiat - feeFiat - amountUsdt * replacementRate;

  const netProfitUsdt =
    replacementRate > 0 ? Math.round((netFiatProfit / replacementRate) * 100) / 100 : 0;

  const costBaseFiat = amountUsdt * replacementRate;
  const marginPct =
    costBaseFiat > 0 ? Math.round(((totalFiat - feeFiat - costBaseFiat) / costBaseFiat) * 10000) / 100 : 0;

  return {
    totalFiatToCollect: totalFiat,
    netProfitUsdt,
    marginPct,
  };
}

/**
 * Parses bank SMS receipts or payment confirmation text from clipboard.
 * Supports popular Venezuelan and Colombian riels (Banesco, Mercantil, BDV, Bancolombia, Pago Móvil).
 */
export function parseBankSmsClipboard(clipboardText: string): ClipboardParseResult {
  if (!clipboardText || !clipboardText.trim()) {
    return {
      detectedBank: null,
      referenceId: null,
      amountFiat: null,
      currency: null,
      rawText: '',
    };
  }

  const raw = clipboardText.trim();
  const lower = raw.toLowerCase();

  let detectedBank: string | null = null;
  let currency: FiatCurrency | null = null;

  if (lower.includes('banesco')) {
    detectedBank = 'Banesco';
    currency = 'VES';
  } else if (lower.includes('mercantil')) {
    detectedBank = 'Mercantil';
    currency = 'VES';
  } else if (lower.includes('venezuela') || lower.includes('bdv') || lower.includes('pago movil')) {
    detectedBank = 'Banco de Venezuela';
    currency = 'VES';
  } else if (lower.includes('bancolombia') || lower.includes('nequi')) {
    detectedBank = 'Bancolombia';
    currency = 'COP';
  } else if (lower.includes('zelle') || lower.includes('usd') || lower.includes('$')) {
    detectedBank = 'USD Wire / Zelle';
    currency = 'USD';
  }

  // Extract reference number (e.g., "Ref: 12345678", "Referencia: 987654", "Operacion: 4567")
  let referenceId: string | null = null;
  const refRegex = /(?:ref(?:erencia)?|operaci[oó]n|comprobante|nro|id)[\s:#.-]*([0-9A-Z]{4,16})/i;
  const refMatch = raw.match(refRegex);
  if (refMatch && refMatch[1]) {
    referenceId = refMatch[1];
  }

  // Extract amount (e.g., "Bs. 1.250,50", "Bs 500", "COP 450.000", "$ 1,500.00")
  let amountFiat: number | null = null;
  const amountRegex = /(?:bs\.?|ves|\$|cop)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/i;
  const amtMatch = raw.match(amountRegex);
  if (amtMatch && amtMatch[1]) {
    let cleanNum = amtMatch[1].replace(/\s/g, '');
    if (cleanNum.includes('.') && cleanNum.includes(',')) {
      if (cleanNum.indexOf('.') < cleanNum.indexOf(',')) {
        cleanNum = cleanNum.replace(/\./g, '').replace(',', '.');
      } else {
        cleanNum = cleanNum.replace(/,/g, '');
      }
    } else if (cleanNum.includes(',')) {
      const parts = cleanNum.split(',');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        cleanNum = cleanNum.replace(/,/g, '');
      } else {
        cleanNum = cleanNum.replace(',', '.');
      }
    } else if (cleanNum.includes('.')) {
      const parts = cleanNum.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        cleanNum = cleanNum.replace(/\./g, '');
      }
    }
    const parsed = parseFloat(cleanNum);
    if (!isNaN(parsed) && parsed > 0) {
      amountFiat = Math.round(parsed * 100) / 100;
    }
  }

  return {
    detectedBank,
    referenceId,
    amountFiat,
    currency: currency ?? 'VES',
    rawText: raw,
  };
}

/**
 * Transitions a deal through the Kanban pipeline, checking TTL, recording timeline,
 * and enforcing reference sealing on CLOSED_WON.
 */
export function transitionDealStage(
  deal: PipelineDeal,
  targetStage: PipelineStage,
  bankReferenceId: string,
  nowTimestamp: number,
  currentLiveRate?: number,
): {
  success: boolean;
  updatedDeal: PipelineDeal;
  requiresReference: boolean;
  error?: string;
} {
  const fromStage = deal.stage;

  if (targetStage === 'STAGE_4_CLOSED') {
    const finalRef = bankReferenceId.trim() || deal.bankReferenceId.trim();
    if (!finalRef) {
      return {
        success: false,
        updatedDeal: deal,
        requiresReference: true,
        error: 'REQUIRED_REFERENCE_FOR_SETTLEMENT',
      };
    }
  }

  // Check TTL expiration if transitioning from STAGE_1_NEW
  let isRateExpired = deal.isRateExpired;
  if (deal.stage === 'STAGE_1_NEW' && targetStage !== 'STAGE_1_NEW') {
    const ttlMs = (deal.quoteTtlMinutes || 15) * 60 * 1000;
    if (nowTimestamp - deal.quotedAt > ttlMs) {
      isRateExpired = true;
    }
  }

  // Recalculate net profit if currentLiveRate provided and stage is still pending
  let netProfitUsdt = deal.netProfitUsdt;
  if (currentLiveRate && currentLiveRate > 0 && targetStage !== 'STAGE_4_CLOSED') {
    const quote = calculateDirectQuote(
      deal.cryptoAmountUsdt,
      currentLiveRate,
      deal.appliedRate,
      0.3,
    );
    netProfitUsdt = quote.netProfitUsdt;
  }

  const nextTimeline: DealTimelineEvent[] = [
    ...deal.timeline,
    {
      timestamp: nowTimestamp,
      fromStage,
      toStage: targetStage,
      notes:
        targetStage === 'STAGE_4_CLOSED'
          ? `Operación liquidada con ref #${bankReferenceId || deal.bankReferenceId}`
          : `Trato movido a ${targetStage}`,
    },
  ];

  const updatedDeal: PipelineDeal = {
    ...deal,
    stage: targetStage,
    bankReferenceId: bankReferenceId.trim() || deal.bankReferenceId,
    netProfitUsdt,
    isRateExpired,
    timeline: nextTimeline,
    closedAt: targetStage === 'STAGE_4_CLOSED' ? (deal.closedAt ?? nowTimestamp) : null,
  };

  return {
    success: true,
    updatedDeal,
    requiresReference: false,
  };
}

/**
 * Compiles the entire CRM workspace state in a single O(n) pass.
 * Computes:
 * - KPIs (Closed profit today, closed volume, in-transit volume, receivables/payables).
 * - Kanban grouped columns with sub-totals.
 * - Bank capacity reservation (Closed + In Transit) and 15-min burst cooldown.
 * - Dynamic SVG intraday performance path.
 */
export function compileCrmWorkspaceState(
  deals: PipelineDeal[],
  contacts: CrmContact[],
  banks: CrmBankAccount[],
  activities: ActivityLogEntry[],
  activeScope: WorkspaceScope,
  liveReplacementRate: number,
  nowTimestamp: number,
): CompiledCrmWorkspaceState {
  const now = new Date(nowTimestamp);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const burstWindow15Min = nowTimestamp - 15 * 60 * 1000;

  // 1. Filter entities strictly by active scope (Zero-Seed & Strict Partitioning)
  const scopedDeals = deals.filter((d) => d.scope === activeScope);
  const scopedContacts = contacts.filter((c) => c.scope === activeScope);
  const scopedBanks = banks.filter((b) => b.scope === activeScope);
  const scopedActivities = activities.filter((a) => a.scope === activeScope);

  // 2. Initialize Kanban Columns
  const kanbanColumns: Record<PipelineStage, KanbanColumn> = {
    STAGE_1_NEW: {
      stage: 'STAGE_1_NEW',
      label: STAGE_CONFIG[activeScope].STAGE_1_NEW.label,
      deals: [],
      totalUsdt: 0,
      totalFiat: 0,
    },
    STAGE_2_TRANSIT: {
      stage: 'STAGE_2_TRANSIT',
      label: STAGE_CONFIG[activeScope].STAGE_2_TRANSIT.label,
      deals: [],
      totalUsdt: 0,
      totalFiat: 0,
    },
    STAGE_3_VERIFY: {
      stage: 'STAGE_3_VERIFY',
      label: STAGE_CONFIG[activeScope].STAGE_3_VERIFY.label,
      deals: [],
      totalUsdt: 0,
      totalFiat: 0,
    },
    STAGE_4_CLOSED: {
      stage: 'STAGE_4_CLOSED',
      label: STAGE_CONFIG[activeScope].STAGE_4_CLOSED.label,
      deals: [],
      totalUsdt: 0,
      totalFiat: 0,
    },
  };

  let closedNetProfitTodayUsdt = 0;
  let closedVolumeTodayUsdt = 0;
  let inTransitVolumeUsdt = 0;
  let closedTradesCountToday = 0;

  // Bank telemetry accumulators
  const bankClosedMap = new Map<string, number>();
  const bankTransitMap = new Map<string, number>();
  const bank15MinBurstCount = new Map<string, number>();

  // Process Deals
  const processedDeals: PipelineDeal[] = [];
  const closedTodayForSvg: PipelineDeal[] = [];

  for (const d of scopedDeals) {
    // Check TTL on quotes
    let isExpired = d.isRateExpired;
    if (d.stage === 'STAGE_1_NEW') {
      const ttlMs = (d.quoteTtlMinutes || 15) * 60 * 1000;
      if (nowTimestamp - d.quotedAt > ttlMs) {
        isExpired = true;
      }
    }

    const liveDeal: PipelineDeal = { ...d, isRateExpired: isExpired };
    processedDeals.push(liveDeal);

    // Group into Kanban
    const col = kanbanColumns[d.stage];
    if (col) {
      col.deals.push(liveDeal);
      col.totalUsdt = Math.round((col.totalUsdt + d.cryptoAmountUsdt) * 100) / 100;
      col.totalFiat = Math.round((col.totalFiat + d.totalFiatAmount) * 100) / 100;
    }

    // Accumulate Bank Reservations
    if (d.stage === 'STAGE_2_TRANSIT' || d.stage === 'STAGE_3_VERIFY') {
      inTransitVolumeUsdt += d.cryptoAmountUsdt;
      const prev = bankTransitMap.get(d.bankAccountId) ?? 0;
      bankTransitMap.set(d.bankAccountId, prev + d.totalFiatAmount);
    }

    // Accumulate Closed deals
    if (d.stage === 'STAGE_4_CLOSED') {
      const closedAt = d.closedAt ?? d.createdAt;
      if (closedAt >= startOfDay) {
        closedNetProfitTodayUsdt += d.netProfitUsdt;
        closedVolumeTodayUsdt += d.cryptoAmountUsdt;
        closedTradesCountToday += 1;
        closedTodayForSvg.push(d);

        const prevClosed = bankClosedMap.get(d.bankAccountId) ?? 0;
        bankClosedMap.set(d.bankAccountId, prevClosed + d.totalFiatAmount);
      }
    }

    // Burst rate calculation (last 15 minutes)
    if (d.createdAt >= burstWindow15Min) {
      const count = bank15MinBurstCount.get(d.bankAccountId) ?? 0;
      bank15MinBurstCount.set(d.bankAccountId, count + 1);
    }
  }

  // 3. Contact Receivables and Payables
  let totalReceivablesUsdt = 0;
  let totalPayablesUsdt = 0;

  for (const c of scopedContacts) {
    if (c.pendingBalanceUsdt < 0) {
      totalReceivablesUsdt += Math.abs(c.pendingBalanceUsdt);
    } else if (c.pendingBalanceUsdt > 0) {
      totalPayablesUsdt += c.pendingBalanceUsdt;
    }
  }

  // Spread efficiency
  const spreadEfficiencyPct =
    closedVolumeTodayUsdt > 0
      ? Math.round((closedNetProfitTodayUsdt / closedVolumeTodayUsdt) * 10000) / 100
      : 0;

  // 4. Compile Bank Telemetry
  let recommendedBankId: string | null = null;
  let highestAvailableCap = -1;

  const bankTelemetry: BankLiveTelemetry[] = scopedBanks.map((b) => {
    const closed = bankClosedMap.get(b.id) ?? 0;
    const transit = bankTransitMap.get(b.id) ?? 0;
    const totalUsed = Math.round((closed + transit) * 100) / 100;
    const dailyCap = b.maxDailyCapFiat > 0 ? b.maxDailyCapFiat : 50000;
    const dailyUsagePct = Math.round((totalUsed / dailyCap) * 1000) / 10;
    const burstCount = bank15MinBurstCount.get(b.id) ?? 0;

    let status: BankBurstStatus = 'AVAILABLE';
    if (burstCount >= b.maxBurstTxPer15Min) {
      status = 'COOLDOWN_BURST';
    } else if (dailyUsagePct >= 100) {
      status = 'DAILY_CAP_REACHED';
    }

    const availableCap = Math.max(0, dailyCap - totalUsed);
    if (status === 'AVAILABLE' && availableCap > highestAvailableCap) {
      highestAvailableCap = availableCap;
      recommendedBankId = b.id;
    }

    return {
      bankAccountId: b.id,
      bankName: b.bankName,
      currency: b.currency,
      currentBalanceFiat: b.currentBalanceFiat,
      maxDailyCapFiat: dailyCap,
      dailyClosedFiat: Math.round(closed * 100) / 100,
      dailyInTransitFiat: Math.round(transit * 100) / 100,
      dailyTotalUsedFiat: totalUsed,
      dailyUsagePct,
      recent15MinTxCount: burstCount,
      maxBurstTxPer15Min: b.maxBurstTxPer15Min,
      status,
      isRecommended: false,
    };
  });

  // Mark recommended bank in list
  for (const t of bankTelemetry) {
    t.isRecommended = t.bankAccountId === recommendedBankId;
  }

  // 5. Generate Dynamic SVG Performance Curve
  let svgPath = '';
  if (closedTodayForSvg.length > 0) {
    const sorted = [...closedTodayForSvg].sort(
      (a, b) => (a.closedAt ?? a.createdAt) - (b.closedAt ?? b.createdAt),
    );

    let cumProfit = 0;
    const points: Array<{ x: number; y: number }> = [{ x: 0, y: 180 }];
    const totalPoints = sorted.length;
    const maxProfit = Math.max(1, closedNetProfitTodayUsdt);

    sorted.forEach((d, idx) => {
      cumProfit += d.netProfitUsdt;
      const x = Math.round(((idx + 1) / totalPoints) * 580) + 10;
      const yNorm = Math.min(1, Math.max(0, cumProfit / maxProfit));
      const y = Math.round(180 - yNorm * 150);
      points.push({ x, y });
    });

    svgPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  }

  return {
    activeScope,
    deals: processedDeals,
    kanbanColumns,
    kpis: {
      closedNetProfitTodayUsdt: Math.round(closedNetProfitTodayUsdt * 100) / 100,
      closedVolumeTodayUsdt: Math.round(closedVolumeTodayUsdt * 100) / 100,
      inTransitVolumeUsdt: Math.round(inTransitVolumeUsdt * 100) / 100,
      totalReceivablesUsdt: Math.round(totalReceivablesUsdt * 100) / 100,
      totalPayablesUsdt: Math.round(totalPayablesUsdt * 100) / 100,
      spreadEfficiencyPct,
      closedTradesCountToday,
    },
    svgPath,
    bankTelemetry,
    recommendedBankId,
    contacts: scopedContacts,
    activities: scopedActivities.sort((a, b) => b.timestamp - a.timestamp),
  };
}

/**
 * Calculates bank reconciliation adjustment drift.
 */
export function calculateBankReconciliationAdjustment(
  systemBalanceFiat: number,
  realBankBalanceFiat: number,
): { driftFiat: number; isBalanced: boolean; formattedDrift: string } {
  const drift = Math.round((realBankBalanceFiat - systemBalanceFiat) * 100) / 100;
  return {
    driftFiat: drift,
    isBalanced: Math.abs(drift) < 0.01,
    formattedDrift: `${drift >= 0 ? '+' : ''}${drift.toFixed(2)}`,
  };
}

/**
 * Generates client WhatsApp statement hiding operator internal margins.
 */
export function buildContactWhatsAppReceipt(
  contact: CrmContact,
  contactDeals: PipelineDeal[],
  hideInternalProfit = true,
): string {
  const closedDeals = contactDeals
    .filter((d) => d.stage === 'STAGE_4_CLOSED')
    .slice(0, 5);

  const dateStr = new Date().toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const lines: string[] = [
    `🏛️ *ESTADO DE CUENTA — ${contact.name.toUpperCase()}*`,
    `📅 Fecha: ${dateStr}`,
    `🆔 Documento: ${contact.documentId || 'No registrado'}`,
    `──────────────────────────`,
  ];

  if (contact.pendingBalanceUsdt !== 0) {
    if (contact.pendingBalanceUsdt > 0) {
      lines.push(`💰 *Saldo a su favor:* +$${contact.pendingBalanceUsdt.toFixed(2)} USDT`);
    } else {
      lines.push(`⚠️ *Saldo por conciliar:* -$${Math.abs(contact.pendingBalanceUsdt).toFixed(2)} USDT`);
    }
    lines.push(`──────────────────────────`);
  } else {
    lines.push(`✅ *Saldo al día:* $0.00 USDT`);
    lines.push(`──────────────────────────`);
  }

  if (closedDeals.length > 0) {
    lines.push(`📋 *Últimas Operaciones Verificadas:*`);
    closedDeals.forEach((d) => {
      const timeStr = new Date(d.closedAt ?? d.createdAt).toLocaleTimeString('es-VE', {
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(
        `• [${timeStr}] ${d.cryptoAmountUsdt.toFixed(2)} USDT @ ${d.appliedRate.toFixed(2)} = ${d.totalFiatAmount.toLocaleString('es-VE')} ${d.fiatCurrency} (Ref: ${d.bankReferenceId || 'N/A'})`,
      );
    });
    lines.push(`──────────────────────────`);
  }

  if (contact.paymentDetailsText) {
    lines.push(`🏦 *Datos de Pago Registrados:*`);
    lines.push(contact.paymentDetailsText);
    lines.push(`──────────────────────────`);
  }

  lines.push(`🔐 _Comprobante oficial auditado por P2P Decisor Suite._`);

  return lines.join('\n');
}

/**
 * Creates idempotent daily profit settlement payload for Finance 360.
 */
export function createDailyProfitSettlementForFinance360(
  deals: PipelineDeal[],
  dateIso: string,
  existingSettlements: DailyNetProfitTransferPayload[],
): {
  success: boolean;
  payload: DailyNetProfitTransferPayload | null;
  error?: string;
} {
  const settlementId = `SETTLE-${dateIso}`;

  if (existingSettlements.some((s) => s.settlementId === settlementId)) {
    return {
      success: false,
      payload: null,
      error: 'SETTLEMENT_ALREADY_EXISTS',
    };
  }

  const startOfDay = new Date(`${dateIso}T00:00:00`).getTime();
  const endOfDay = new Date(`${dateIso}T23:59:59.999`).getTime();

  const closedToday = deals.filter(
    (d) =>
      d.scope === 'P2P_DESK' &&
      d.stage === 'STAGE_4_CLOSED' &&
      (d.closedAt ?? d.createdAt) >= startOfDay &&
      (d.closedAt ?? d.createdAt) <= endOfDay,
  );

  const netProfitUsdt = closedToday.reduce((acc, d) => acc + d.netProfitUsdt, 0);

  if (netProfitUsdt <= 0) {
    return {
      success: false,
      payload: null,
      error: 'NO_POSITIVE_PROFIT_TO_TRANSFER',
    };
  }

  return {
    success: true,
    payload: {
      settlementId,
      dateIso,
      netProfitUsdt: Math.round(netProfitUsdt * 100) / 100,
      tradesCount: closedToday.length,
      timestamp: Date.now(),
    },
  };
}
