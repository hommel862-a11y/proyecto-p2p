/**
 * Client Intelligence, Compliance & Dual-Ledger Operational Engine.
 * Pure TypeScript domain engine without Angular or DOM dependencies.
 * Tested with Vitest. Strict Zero-Seed and Clean Data Policy.
 */

import { roundMoney } from './money';

export type WorkspaceScope = 'P2P_DESK' | 'FINANCE_360';
export type FiatCurrency = 'VES' | 'COP' | 'USD';
export type CrmContactCategory = 'CLIENT_P2P' | 'VIP_OTC' | 'SUPPLIER_360' | 'CREDITOR_360';
export type BankBurstStatus = 'AVAILABLE' | 'COOLDOWN_BURST' | 'DAILY_CAP_REACHED';

export interface BankHolderDetails {
  documentId: string;
  phone: string;
  accountNumber: string;
  holderName: string;
}

export interface OperationalBankAccount {
  id: string;
  scope: WorkspaceScope;
  bankName: string;
  currency: FiatCurrency;
  holderDetails: BankHolderDetails;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  feePct: number;
  maxBurstTxPer15Min: number;
}

export interface RealTimeTradeEntry {
  id: string;
  timestamp: number;
  scope: WorkspaceScope;
  clientId: string;
  clientName: string;
  clientDocId: string;
  bankAccountId: string;
  bankName: string;
  bankReferenceId: string;
  fiatCurrency: FiatCurrency;
  fiatAmount: number;
  cryptoAmountUsdt: number;
  appliedRate: number;
  replacementRate: number;
  netPnlUsdt: number;
  frictionFiat: number;
}

export interface CrmContactLedger {
  clientId: string;
  scope: WorkspaceScope;
  clientName: string;
  clientDocId: string;
  category: CrmContactCategory;
  /**
   * Pending balance in USDT:
   * Positive value (> 0) = Operator owes contact (Saldo a favor del contacto).
   * Negative value (< 0) = Contact owes operator (Cuenta por cobrar al contacto).
   */
  pendingBalanceUsdt: number;
  pendingBalanceFiat: number;
  lifetimeVolumeUsdt: number;
  lifetimeNetPnlUsdt: number;
  verifiedReferences: string[];
  lastActivityTimestamp: number;
}

export interface DailyNetProfitTransferPayload {
  settlementId: string; // Format: SETTLE-YYYY-MM-DD
  dateIso: string;
  netProfitUsdt: number;
  tradesCount: number;
  timestamp: number;
}

export interface BankLiveTelemetry {
  bankAccountId: string;
  bankName: string;
  currency: FiatCurrency;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  dailyUsedFiat: number;
  dailyUsagePct: number;
  recent15MinTxCount: number;
  maxBurstTxPer15Min: number;
  status: BankBurstStatus;
  isRecommended: boolean;
}

export interface CompiledDeskKpis {
  todayNetPnlUsdt: number;
  todayVolumeUsdt: number;
  todayFrictionUsdt: number;
  spreadEfficiencyPct: number;
  totalTradesCount: number;
}

export interface SvgCurvePoint {
  x: number;
  y: number;
  pnl: number;
  time: string;
}

export interface CompiledDeskState {
  activeScope: WorkspaceScope;
  filteredTrades: RealTimeTradeEntry[];
  todayTrades: RealTimeTradeEntry[];
  kpis: CompiledDeskKpis;
  svgPath: string;
  svgPoints: SvgCurvePoint[];
  bankTelemetry: BankLiveTelemetry[];
  recommendedBankId: string | null;
  contacts: CrmContactLedger[];
}

export interface ReferenceCollisionCheck {
  isDuplicate: boolean;
  existingEntry: RealTimeTradeEntry | null;
}

export interface BankReconciliationAdjustment {
  driftFiat: number;
  isBalanced: boolean;
  adjustmentType: 'SURPLUS' | 'DEFICIT' | 'BALANCED';
  formattedDrift: string;
}

export interface DirectCommercialQuote {
  totalFiatToCollect: number;
  netProfitUsdt: number;
  marginPct: number;
  effectiveSpreadFiat: number;
}

export interface SettlementCreationResult {
  success: boolean;
  payload: DailyNetProfitTransferPayload | null;
  error?: 'SETTLEMENT_ALREADY_EXISTS' | 'NO_POSITIVE_PROFIT_TO_TRANSFER' | 'NO_TRADES_FOR_DATE';
}

/**
 * Clean reference helper: trims, removes spaces and standardizes to uppercase.
 */
export function normalizeBankReference(ref: string | null | undefined): string {
  if (!ref) return '';
  return ref.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Instant anti-fraud check for bank reference collision across all recorded trades.
 */
export function verifyReferenceCollision(
  trades: readonly RealTimeTradeEntry[],
  candidateRef: string | null | undefined,
): ReferenceCollisionCheck {
  const cleanCandidate = normalizeBankReference(candidateRef);
  if (!cleanCandidate) {
    return { isDuplicate: false, existingEntry: null };
  }

  const existingEntry = trades.find(
    (t) => normalizeBankReference(t.bankReferenceId) === cleanCandidate,
  );

  return {
    isDuplicate: !!existingEntry,
    existingEntry: existingEntry ?? null,
  };
}

/**
 * Evaluates bank reconciliation drift between recorded ledger balance and physical app balance.
 */
export function calculateBankReconciliationAdjustment(
  systemBalanceFiat: number,
  realBankBalanceFiat: number,
): BankReconciliationAdjustment {
  const driftFiat = roundMoney(realBankBalanceFiat - systemBalanceFiat, 2);
  const isBalanced = Math.abs(driftFiat) < 0.01;
  const adjustmentType: 'SURPLUS' | 'DEFICIT' | 'BALANCED' = isBalanced
    ? 'BALANCED'
    : driftFiat > 0
      ? 'SURPLUS'
      : 'DEFICIT';

  const formattedDrift = driftFiat > 0 ? `+${driftFiat.toFixed(2)}` : driftFiat.toFixed(2);

  return {
    driftFiat,
    isBalanced,
    adjustmentType,
    formattedDrift,
  };
}

/**
 * Direct commercial quote calculator (no BPS jargon).
 * Given crypto amount, operator replacement rate, target client rate, and bank fee %.
 */
export function calculateDirectCommercialQuote(
  amountUsdt: number,
  replacementRate: number,
  clientRate: number,
  bankFeePct = 0,
): DirectCommercialQuote {
  if (amountUsdt <= 0 || replacementRate <= 0 || clientRate <= 0) {
    return {
      totalFiatToCollect: 0,
      netProfitUsdt: 0,
      marginPct: 0,
      effectiveSpreadFiat: 0,
    };
  }

  const totalFiatToCollect = roundMoney(amountUsdt * clientRate, 2);
  const bankFrictionFiat = roundMoney(totalFiatToCollect * (Math.max(0, bankFeePct) / 100), 2);
  const netFiatCost = roundMoney(amountUsdt * replacementRate, 2);
  const netFiatProfit = roundMoney(totalFiatToCollect - bankFrictionFiat - netFiatCost, 2);
  const netProfitUsdt = roundMoney(netFiatProfit / replacementRate, 2);
  const marginPct = roundMoney(
    ((clientRate - replacementRate) / replacementRate) * 100 - bankFeePct,
    2,
  );
  const effectiveSpreadFiat = roundMoney(clientRate - replacementRate, 4);

  return {
    totalFiatToCollect,
    netProfitUsdt,
    marginPct,
    effectiveSpreadFiat,
  };
}

/**
 * Generates formatted WhatsApp commercial statement ready for 1-click dispatch.
 * Guarantees zero leakage of operator internal PnL or replacement rate when privacy is kept.
 */
export function buildClientWhatsAppStatement(
  contact: CrmContactLedger,
  scopeTrades: readonly RealTimeTradeEntry[],
  includeInternalProfit = false,
  deskBrand = 'P2P DECISOR SUITE',
): string {
  const contactTrades = scopeTrades.filter((t) => t.clientId === contact.clientId);
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString();

  const balanceStatus =
    contact.pendingBalanceUsdt > 0.01
      ? `A FAVOR DEL CLIENTE (+${contact.pendingBalanceUsdt.toFixed(2)} USDT)`
      : contact.pendingBalanceUsdt < -0.01
        ? `CUENTA POR COBRAR (${contact.pendingBalanceUsdt.toFixed(2)} USDT)`
        : 'AL DÍA ($0.00 USDT)';

  const lines: string[] = [
    `🏛️ *ESTADO DE CUENTA — ${deskBrand}*`,
    `📅 *Fecha de Emisión*: ${dateStr} ${timeStr}`,
    `👤 *Cliente / Contacto*: ${contact.clientName}`,
    `🪪 *Documento / RIF*: ${contact.clientDocId || 'N/A'}`,
    '',
    `💼 *RESUMEN DE CUENTA CORRIENTE*:`,
    `• *Estado*: ${balanceStatus}`,
    `• *Saldo Pendiente*: ${contact.pendingBalanceUsdt.toFixed(2)} USDT (${contact.pendingBalanceFiat.toLocaleString('es-VE', { maximumFractionDigits: 2 })} Fiat)`,
    `• *Total Operaciones*: ${contactTrades.length}`,
    `• *Volumen Histórico*: ${contact.lifetimeVolumeUsdt.toLocaleString('es-VE', { maximumFractionDigits: 2 })} USDT`,
  ];

  if (includeInternalProfit) {
    lines.push(
      `• *Margen Generado (Auditoría Interna)*: +${contact.lifetimeNetPnlUsdt.toFixed(2)} USDT`,
    );
  }

  if (contactTrades.length > 0) {
    lines.push('');
    lines.push(`📑 *ÚLTIMOS MOVIMIENTOS VERIFICADOS*:`);
    const recentTrades = [...contactTrades]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    for (const t of recentTrades) {
      const tDate = new Date(t.timestamp).toLocaleDateString([], {
        day: '2-digit',
        month: '2-digit',
      });
      const tTime = new Date(t.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(
        `- ${tDate} ${tTime}: ${t.cryptoAmountUsdt.toFixed(2)} USDT @ ${t.appliedRate.toFixed(2)} ${t.fiatCurrency} | Banco: ${t.bankName} (Ref: ${t.bankReferenceId || 'S/R'})`,
      );
    }
  }

  if (contact.verifiedReferences.length > 0) {
    lines.push('');
    lines.push(
      `🔒 *Referencias Verificadas*: ${contact.verifiedReferences.slice(0, 4).join(', ')}${contact.verifiedReferences.length > 4 ? ` (+${contact.verifiedReferences.length - 4} más)` : ''}`,
    );
  }

  lines.push('');
  lines.push(`_Comprobante emitido con liquidación verificada y respaldo contable._`);

  return lines.join('\n');
}

/**
 * Validates and constructs the settlement bridge payload for Finance 360.
 * Enforces positive profit check and idempotent date settlement.
 */
export function createFinance360ProfitSettlement(
  todayP2pTrades: readonly RealTimeTradeEntry[],
  dateIso: string,
  existingSettlements: readonly DailyNetProfitTransferPayload[],
): SettlementCreationResult {
  const settlementId = `SETTLE-${dateIso}`;
  const alreadySettled = existingSettlements.some((s) => s.settlementId === settlementId);

  if (alreadySettled) {
    return { success: false, payload: null, error: 'SETTLEMENT_ALREADY_EXISTS' };
  }

  // Filter strictly P2P_DESK trades
  const p2pTrades = todayP2pTrades.filter((t) => t.scope === 'P2P_DESK');
  if (p2pTrades.length === 0) {
    return { success: false, payload: null, error: 'NO_TRADES_FOR_DATE' };
  }

  const todayNetPnlUsdt = roundMoney(
    p2pTrades.reduce((acc, t) => acc + (t.netPnlUsdt || 0), 0),
    2,
  );

  if (todayNetPnlUsdt <= 0) {
    return { success: false, payload: null, error: 'NO_POSITIVE_PROFIT_TO_TRANSFER' };
  }

  return {
    success: true,
    payload: {
      settlementId,
      dateIso,
      netProfitUsdt: todayNetPnlUsdt,
      tradesCount: p2pTrades.length,
      timestamp: Date.now(),
    },
  };
}

/**
 * Single-pass O(n) live desk state compiler.
 * Strictly respects activeScope and executes Zero-Seed clean data policy.
 */
export function compileLiveDeskState(
  trades: readonly RealTimeTradeEntry[],
  banks: readonly OperationalBankAccount[],
  contacts: readonly CrmContactLedger[],
  activeScope: WorkspaceScope,
  nowTimestamp: number = Date.now(),
): CompiledDeskState {
  // 1. Strict Isolation Filter by activeScope
  const filteredTrades = trades.filter((t) => t.scope === activeScope);
  const scopedBanks = banks.filter((b) => b.scope === activeScope);
  const scopedContacts = contacts.filter((c) => c.scope === activeScope);

  // 2. Identify start of today in local date
  const now = new Date(nowTimestamp);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayTrades = filteredTrades.filter((t) => t.timestamp >= startOfDay);

  // 3. Compute Desk KPIs
  let todayNetPnlUsdt = 0;
  let todayVolumeUsdt = 0;
  let todayFrictionUsdt = 0;

  for (const t of todayTrades) {
    todayNetPnlUsdt += t.netPnlUsdt || 0;
    todayVolumeUsdt += t.cryptoAmountUsdt || 0;
    if (t.appliedRate > 0 && t.frictionFiat > 0) {
      todayFrictionUsdt += t.frictionFiat / t.appliedRate;
    }
  }

  todayNetPnlUsdt = roundMoney(todayNetPnlUsdt, 2);
  todayVolumeUsdt = roundMoney(todayVolumeUsdt, 2);
  todayFrictionUsdt = roundMoney(todayFrictionUsdt, 2);

  const spreadEfficiencyPct =
    todayVolumeUsdt > 0 ? roundMoney((todayNetPnlUsdt / todayVolumeUsdt) * 100, 2) : 0;

  const kpis: CompiledDeskKpis = {
    todayNetPnlUsdt,
    todayVolumeUsdt,
    todayFrictionUsdt,
    spreadEfficiencyPct,
    totalTradesCount: todayTrades.length,
  };

  // 4. Compute Bank Live Telemetry and Burst Cooldowns
  const burstWindowStart = nowTimestamp - 15 * 60 * 1000;
  const bankTelemetry: BankLiveTelemetry[] = [];
  let lowestUsagePct = Number.POSITIVE_INFINITY;
  let recommendedBankId: string | null = null;

  for (const bank of scopedBanks) {
    const bankTrades = filteredTrades.filter((t) => t.bankAccountId === bank.id);
    const todayBankTrades = todayTrades.filter((t) => t.bankAccountId === bank.id);

    const dailyUsedFiat = roundMoney(
      todayBankTrades.reduce((acc, t) => acc + (t.fiatAmount || 0), 0),
      2,
    );

    const dailyUsagePct =
      bank.maxDailyCapFiat > 0
        ? roundMoney((dailyUsedFiat / bank.maxDailyCapFiat) * 100, 1)
        : 0;

    const recent15MinTxCount = bankTrades.filter((t) => t.timestamp >= burstWindowStart).length;

    let status: BankBurstStatus = 'AVAILABLE';
    if (bank.maxDailyCapFiat > 0 && dailyUsedFiat >= bank.maxDailyCapFiat) {
      status = 'DAILY_CAP_REACHED';
    } else if (bank.maxBurstTxPer15Min > 0 && recent15MinTxCount >= bank.maxBurstTxPer15Min) {
      status = 'COOLDOWN_BURST';
    }

    // Determine candidate for recommendation
    if (status === 'AVAILABLE' && dailyUsagePct < lowestUsagePct) {
      lowestUsagePct = dailyUsagePct;
      recommendedBankId = bank.id;
    }

    bankTelemetry.push({
      bankAccountId: bank.id,
      bankName: bank.bankName,
      currency: bank.currency,
      currentBalanceFiat: bank.currentBalanceFiat,
      maxDailyCapFiat: bank.maxDailyCapFiat,
      dailyUsedFiat,
      dailyUsagePct,
      recent15MinTxCount,
      maxBurstTxPer15Min: bank.maxBurstTxPer15Min,
      status,
      isRecommended: false, // will update below
    });
  }

  // Set recommendation flag
  if (recommendedBankId) {
    const rec = bankTelemetry.find((b) => b.bankAccountId === recommendedBankId);
    if (rec) rec.isRecommended = true;
  }

  // 5. Update and Consolidate CRM Contacts with Real Verified Operations
  const updatedContacts: CrmContactLedger[] = scopedContacts.map((contact) => {
    const clientTrades = filteredTrades.filter((t) => t.clientId === contact.clientId);
    const lifetimeVolumeUsdt = roundMoney(
      clientTrades.reduce((acc, t) => acc + (t.cryptoAmountUsdt || 0), 0),
      2,
    );
    const lifetimeNetPnlUsdt = roundMoney(
      clientTrades.reduce((acc, t) => acc + (t.netPnlUsdt || 0), 0),
      2,
    );

    const verifiedReferences = Array.from(
      new Set(
        clientTrades
          .map((t) => normalizeBankReference(t.bankReferenceId))
          .filter((ref) => ref.length > 0),
      ),
    );

    const latestTs = clientTrades.length > 0 ? Math.max(...clientTrades.map((t) => t.timestamp)) : 0;
    const lastActivityTimestamp = Math.max(contact.lastActivityTimestamp || 0, latestTs);

    return {
      ...contact,
      lifetimeVolumeUsdt,
      lifetimeNetPnlUsdt,
      verifiedReferences,
      lastActivityTimestamp,
    };
  });

  // 6. Dynamic Real SVG Curve Generation
  let svgPath = '';
  const svgPoints: SvgCurvePoint[] = [];

  if (todayTrades.length > 0) {
    const sortedTrades = [...todayTrades].sort((a, b) => a.timestamp - b.timestamp);
    const chartWidth = 500;
    const chartHeight = 100;
    const paddingY = 12;

    let cumulativePnl = 0;
    const pnlProgression: { pnl: number; time: string }[] = [{ pnl: 0, time: 'Inicio' }];

    for (const t of sortedTrades) {
      cumulativePnl += t.netPnlUsdt || 0;
      const tTime = new Date(t.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      pnlProgression.push({ pnl: roundMoney(cumulativePnl, 2), time: tTime });
    }

    const allPnls = pnlProgression.map((p) => p.pnl);
    const minPnl = Math.min(...allPnls);
    const maxPnl = Math.max(...allPnls);
    const range = maxPnl - minPnl;

    const count = pnlProgression.length;
    for (let i = 0; i < count; i++) {
      const item = pnlProgression[i];
      const x = roundMoney((i / (count - 1 || 1)) * chartWidth, 1);
      let y = chartHeight / 2;
      if (range > 0.0001) {
        // Invert Y so highest PnL is at the top
        y = roundMoney(
          chartHeight - paddingY - ((item.pnl - minPnl) / range) * (chartHeight - 2 * paddingY),
          1,
        );
      }
      svgPoints.push({ x, y, pnl: item.pnl, time: item.time });
    }

    if (svgPoints.length > 0) {
      svgPath = svgPoints.reduce((acc, pt, idx) => {
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '');
    }
  }

  return {
    activeScope,
    filteredTrades,
    todayTrades,
    kpis,
    svgPath,
    svgPoints,
    bankTelemetry,
    recommendedBankId,
    contacts: updatedContacts,
  };
}
