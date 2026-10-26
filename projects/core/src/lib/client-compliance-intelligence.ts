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

  // Extract amount: prioritize explicit currency / marker patterns (e.g., "Bs. 1.250,50", "por Bs 500", "COP 450.000", "$ 1,500.00", "monto: 2500")
  let amountFiat: number | null = null;
  const explicitAmountRegex =
    /(?:bs\.?|ves|\$|cop|monto[:\s]*|por\s+(?:bs\.?|ves|\$|cop)?)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/i;
  let amtMatch = raw.match(explicitAmountRegex);

  // Fallback to formatted number with thousand separators or decimals if no explicit marker
  if (!amtMatch) {
    const fallbackAmountRegex = /\b([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})\b/;
    amtMatch = raw.match(fallbackAmountRegex);
  }
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
  activitiesOrScope: ActivityLogEntry[] | WorkspaceScope,
  activeScopeOrLiveRate?: WorkspaceScope | number,
  liveReplacementRateOrNow?: number,
  nowTimestamp?: number,
): CompiledCrmWorkspaceState {
  let activities: ActivityLogEntry[] = [];
  let activeScope: WorkspaceScope = 'P2P_DESK';
  let liveReplacementRate = 0;
  let nowMs = Date.now();

  if (Array.isArray(activitiesOrScope)) {
    activities = activitiesOrScope;
    activeScope = (activeScopeOrLiveRate as WorkspaceScope) ?? 'P2P_DESK';
    const rateVal = liveReplacementRateOrNow as number | undefined;
    liveReplacementRate = typeof rateVal === 'number' && Number.isFinite(rateVal) && rateVal > 0 ? rateVal : 0;
    nowMs = typeof nowTimestamp === 'number' && Number.isFinite(nowTimestamp) ? nowTimestamp : Date.now();
  } else {
    activeScope = activitiesOrScope;
    const rateVal = activeScopeOrLiveRate as number | undefined;
    liveReplacementRate = typeof rateVal === 'number' && Number.isFinite(rateVal) && rateVal > 0 ? rateVal : 0;
    const nowVal = liveReplacementRateOrNow as number | undefined;
    nowMs = typeof nowVal === 'number' && Number.isFinite(nowVal) ? nowVal : Date.now();
    activities = [];
  }

  const now = new Date(nowMs);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const burstWindow15Min = nowMs - 15 * 60 * 1000;

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
      if (nowMs - d.quotedAt > ttlMs) {
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

// =============================================================================
// 7. STORAGE KEYS & BACKUP VALIDATION / HYDRATION ENGINE
// =============================================================================

export const CRM_STORAGE_KEYS = {
  DEALS: 'p2p.crm.deals',
  CONTACTS: 'p2p.crm.contacts',
  BANKS: 'p2p.crm.banks',
  ACTIVITIES: 'p2p.crm.activities',
  SETTLEMENTS: 'p2p.crm.settlements',
  ACTIVE_SCOPE: 'p2p.crm.active-scope',
  PRIVACY_MODE: 'p2p.crm.privacy-mode',
  ACTIVE_VIEW: 'p2p.crm.active-view',
  CONVERSATIONS: 'p2p.crm.conversations',
  INVOICES_OR_QUOTES: 'p2p.crm.invoices-quotes',
  OMNICHANNEL_CONFIG: 'p2p.crm.omnichannel.config',
} as const;

export * from './crm-omnichannel-billing';

export function safeHydrateCrmCollection<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw as T[];
}

export interface CrmSanitizationReport {
  valid: boolean;
  errors: string[];
  quarantinedCount: number;
  sanitizedPayload: {
    deals: PipelineDeal[];
    contacts: CrmContact[];
    banks: CrmBankAccount[];
    activities: ActivityLogEntry[];
    settlements: DailyNetProfitTransferPayload[];
  };
}

export function validateAndSanitizeCrmBackupPayload(
  raw: unknown,
  fallbackScope: WorkspaceScope = 'P2P_DESK',
): CrmSanitizationReport {
  const errors: string[] = [];
  let quarantinedCount = 0;

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      errors: ['El archivo de respaldo no contiene un objeto JSON válido.'],
      quarantinedCount: 0,
      sanitizedPayload: { deals: [], contacts: [], banks: [], activities: [], settlements: [] },
    };
  }

  const obj = raw as Record<string, unknown>;
  const cleanDeals: PipelineDeal[] = [];
  const cleanContacts: CrmContact[] = [];
  const cleanBanks: CrmBankAccount[] = [];
  const cleanActivities: ActivityLogEntry[] = [];
  const cleanSettlements: DailyNetProfitTransferPayload[] = [];

  const isValidScope = (s: unknown): s is WorkspaceScope => s === 'P2P_DESK' || s === 'FINANCE_360';

  // 1. Deals
  if (Array.isArray(obj['deals'])) {
    for (const d of obj['deals']) {
      if (!d || typeof d !== 'object') {
        quarantinedCount++;
        continue;
      }
      const rawDeal = d as Partial<PipelineDeal>;
      let scope = rawDeal.scope;
      if (!isValidScope(scope)) {
        if (isValidScope(fallbackScope)) {
          scope = fallbackScope;
        } else {
          quarantinedCount++;
          errors.push(`Operación omitida por ámbito inválido o ausente: ID ${String(rawDeal.id || 'desconocido')}`);
          continue;
        }
      }

      cleanDeals.push({
        id: String(rawDeal.id || `DEAL-${Date.now().toString().slice(-6)}`),
        scope,
        title: String(rawDeal.title || 'Operación P2P'),
        contactId: String(rawDeal.contactId || ''),
        contactName: String(rawDeal.contactName || 'Cliente General'),
        bankAccountId: String(rawDeal.bankAccountId || ''),
        bankName: String(rawDeal.bankName || 'Banco Desconocido'),
        stage: (rawDeal.stage as PipelineStage) || 'STAGE_1_NEW',
        fiatCurrency: (rawDeal.fiatCurrency as FiatCurrency) || 'VES',
        cryptoAmountUsdt: Number.isFinite(rawDeal.cryptoAmountUsdt) ? Number(rawDeal.cryptoAmountUsdt) : 0,
        appliedRate: Number.isFinite(rawDeal.appliedRate) ? Number(rawDeal.appliedRate) : 0,
        replacementRate: Number.isFinite(rawDeal.replacementRate) ? Number(rawDeal.replacementRate) : 0,
        totalFiatAmount: Number.isFinite(rawDeal.totalFiatAmount) ? Number(rawDeal.totalFiatAmount) : 0,
        paidFiatAmount: Number.isFinite(rawDeal.paidFiatAmount) ? Number(rawDeal.paidFiatAmount) : 0,
        netProfitUsdt: Number.isFinite(rawDeal.netProfitUsdt) ? Number(rawDeal.netProfitUsdt) : 0,
        bankReferenceId: String(rawDeal.bankReferenceId || ''),
        quoteTtlMinutes: Number.isFinite(rawDeal.quoteTtlMinutes) ? Number(rawDeal.quoteTtlMinutes) : 15,
        quotedAt: Number.isFinite(rawDeal.quotedAt) ? Number(rawDeal.quotedAt) : Date.now(),
        isRateExpired: Boolean(rawDeal.isRateExpired),
        timeline: Array.isArray(rawDeal.timeline) ? rawDeal.timeline : [],
        createdAt: Number.isFinite(rawDeal.createdAt) ? Number(rawDeal.createdAt) : Date.now(),
        closedAt: typeof rawDeal.closedAt === 'number' && Number.isFinite(rawDeal.closedAt) ? rawDeal.closedAt : null,
      });
    }
  }

  // 2. Contacts
  if (Array.isArray(obj['contacts'])) {
    for (const c of obj['contacts']) {
      if (!c || typeof c !== 'object') {
        quarantinedCount++;
        continue;
      }
      const rawC = c as Partial<CrmContact>;
      let scope = rawC.scope;
      if (!isValidScope(scope)) {
        if (isValidScope(fallbackScope)) {
          scope = fallbackScope;
        } else {
          quarantinedCount++;
          errors.push(`Contacto omitido por ámbito inválido o ausente: ID ${String(rawC.id || 'desconocido')}`);
          continue;
        }
      }

      cleanContacts.push({
        id: String(rawC.id || `CNT-${Date.now().toString().slice(-6)}`),
        scope,
        name: String(rawC.name || 'Sin Nombre'),
        documentId: String(rawC.documentId || ''),
        phoneOrContact: String(rawC.phoneOrContact || ''),
        category: (rawC.category as CrmContactCategory) || (scope === 'P2P_DESK' ? 'CLIENT_P2P' : 'CLIENT_360'),
        paymentDetailsText: String(rawC.paymentDetailsText || ''),
        creditLimitUsdt: Number.isFinite(rawC.creditLimitUsdt) ? Number(rawC.creditLimitUsdt) : 0,
        pendingBalanceUsdt: Number.isFinite(rawC.pendingBalanceUsdt) ? Number(rawC.pendingBalanceUsdt) : 0,
        maxPendingExposureUsdt: Number.isFinite(rawC.maxPendingExposureUsdt) ? Number(rawC.maxPendingExposureUsdt) : 0,
        isDebtIndexedToUsdt: Boolean(rawC.isDebtIndexedToUsdt),
        verifiedReferences: Array.isArray(rawC.verifiedReferences) ? rawC.verifiedReferences.map(String) : [],
        createdAt: Number.isFinite(rawC.createdAt) ? Number(rawC.createdAt) : Date.now(),
      });
    }
  }

  // 3. Banks
  if (Array.isArray(obj['banks'])) {
    for (const b of obj['banks']) {
      if (!b || typeof b !== 'object') {
        quarantinedCount++;
        continue;
      }
      const rawB = b as Partial<CrmBankAccount>;
      let scope = rawB.scope;
      if (!isValidScope(scope)) {
        if (isValidScope(fallbackScope)) {
          scope = fallbackScope;
        } else {
          quarantinedCount++;
          errors.push(`Banco omitido por ámbito inválido o ausente: ID ${String(rawB.id || 'desconocido')}`);
          continue;
        }
      }

      cleanBanks.push({
        id: String(rawB.id || `BNK-${Date.now().toString().slice(-6)}`),
        scope,
        bankName: String(rawB.bankName || 'Banco'),
        currency: (rawB.currency as FiatCurrency) || 'VES',
        holderDetailsText: String(rawB.holderDetailsText || ''),
        currentBalanceFiat: Number.isFinite(rawB.currentBalanceFiat) ? Number(rawB.currentBalanceFiat) : 0,
        maxDailyCapFiat: Number.isFinite(rawB.maxDailyCapFiat) ? Number(rawB.maxDailyCapFiat) : 0,
        feePct: Number.isFinite(rawB.feePct) ? Number(rawB.feePct) : 0.3,
        maxBurstTxPer15Min: Number.isFinite(rawB.maxBurstTxPer15Min) ? Number(rawB.maxBurstTxPer15Min) : 5,
      });
    }
  }

  // 4. Activities
  if (Array.isArray(obj['activities'])) {
    for (const a of obj['activities']) {
      if (!a || typeof a !== 'object') {
        quarantinedCount++;
        continue;
      }
      const rawA = a as Partial<ActivityLogEntry>;
      let scope = rawA.scope;
      if (!isValidScope(scope)) {
        if (isValidScope(fallbackScope)) {
          scope = fallbackScope;
        } else {
          quarantinedCount++;
          continue;
        }
      }

      cleanActivities.push({
        id: String(rawA.id || `ACT-${Date.now().toString().slice(-6)}`),
        scope,
        timestamp: Number.isFinite(rawA.timestamp) ? Number(rawA.timestamp) : Date.now(),
        type: (rawA.type as ActivityType) || 'STAGE_MOVED',
        description: String(rawA.description || ''),
        amountUsdt: Number.isFinite(rawA.amountUsdt) ? Number(rawA.amountUsdt) : 0,
        referenceId: rawA.referenceId ? String(rawA.referenceId) : undefined,
      });
    }
  }

  // 5. Settlements
  if (Array.isArray(obj['settlements'])) {
    for (const s of obj['settlements']) {
      if (!s || typeof s !== 'object') {
        quarantinedCount++;
        continue;
      }
      const rawS = s as Partial<DailyNetProfitTransferPayload>;
      cleanSettlements.push({
        settlementId: String(rawS.settlementId || `SETTLE-${new Date().toISOString().slice(0, 10)}`),
        dateIso: String(rawS.dateIso || new Date().toISOString().slice(0, 10)),
        netProfitUsdt: Number.isFinite(rawS.netProfitUsdt) ? Number(rawS.netProfitUsdt) : 0,
        tradesCount: Number.isFinite(rawS.tradesCount) ? Number(rawS.tradesCount) : 0,
        timestamp: Number.isFinite(rawS.timestamp) ? Number(rawS.timestamp) : Date.now(),
      });
    }
  }

  return {
    valid: true,
    errors,
    quarantinedCount,
    sanitizedPayload: {
      deals: cleanDeals,
      contacts: cleanContacts,
      banks: cleanBanks,
      activities: cleanActivities,
      settlements: cleanSettlements,
    },
  };
}
