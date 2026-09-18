/**
 * Operations Workflow, CRM, SOP Governance & Dynamic Ledger Core Engine.
 * Implements 10 institutional deterministic models for direct lead qualification,
 * social funnels, RPA reconciliation, crisis triage, SOP enforcement, and spreadsheet ledgers.
 * 0 external framework dependencies. Pure deterministic functions.
 */

export interface DirectLeadQualificationInput {
  leadChannel: 'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM_DM';
  estimatedWeeklyVolumeUsdt: number;
  paymentMethodPreferred: string;
  isKycVerified: boolean;
  primaryConcern: 'PRICE' | 'SECURITY' | 'SPEED' | 'PAYMENT_LIMITS';
  currentParallelRate: number;
}

export interface DirectLeadQualificationResult {
  qualificationScore: number;
  leadTier: 'VIP_COMMERCIAL' | 'RETAIL_TRADER' | 'HIGH_RISK_SUSPECT';
  recommendedNetMarginBps: number;
  quotedRate: number;
  objectionHandlingScript: string;
  actionProtocol: 'ONBOARD_IMMEDIATELY' | 'REQUEST_IDENTITY_VERIFICATION' | 'DECLINE_HIGH_RISK';
}

export interface SocialContentFunnelInput {
  targetAudience: 'RETAIL_SAVERS' | 'MERCHANT_IMPORTERS' | 'P2P_ARBITRAGEURS';
  platform: 'INSTAGRAM' | 'TIKTOK' | 'TWITTER_X';
  currentBcvGapPct: number;
  educationalTheme: 'INFLATION_HEDGE' | 'TRIANGULATION_BASICS' | 'AVOID_BANK_FREEZES';
}

export interface SocialContentFunnelResult {
  hookHeadline: string;
  educationalBody: string;
  callToActionCta: string;
  recommendedPostingWindow: string;
  targetConversionRatePct: number;
}

export interface CompetitorBenchmarkInput {
  ourCurrentPrice: number;
  competitorOffers: Array<{
    operatorName: string;
    price: number;
    completionRatePct: number;
    totalOrdersCount: number;
    paymentMethods: string[];
  }>;
  targetSide: 'BUY' | 'SELL';
  ourMinMarginPct: number;
}

export interface CompetitorBenchmarkResult {
  marketMedianPrice: number;
  ourPositionInRank: number;
  priceGapVsLeader: number;
  isPriceCompetitive: boolean;
  underservedPaymentMethods: string[];
  strategicRecommendation: string;
}

export interface WorkspaceSyncInput {
  entityType: 'ORDER' | 'DISPUTE' | 'BANK_INCIDENT' | 'SOP_VIOLATION';
  referenceId: string;
  urgencyLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  operatorAssigned: string;
  summaryText: string;
  metadataPayload: Record<string, unknown>;
}

export interface WorkspaceSyncResult {
  syncPayload: {
    event: string;
    reference: string;
    priorityColor: string;
    notionProperties: Record<string, string>;
    clickUpTags: string[];
    trelloCardTitle: string;
  };
  deliveryTimestamp: number;
  retryPolicy: { maxRetries: number; backoffSeconds: number };
}

export interface DesktopRpaInput {
  bankName: string;
  rawBankStatements: Array<{
    referenceNumber: string;
    amount: number;
    beneficiaryOrPayer: string;
    timestamp: string;
  }>;
  registeredP2pOrders: Array<{
    orderId: string;
    expectedBankReference: string;
    expectedAmountFiat: number;
    counterpartyRealName: string;
  }>;
}

export interface DesktopRpaResult {
  totalStatementsParsed: number;
  matchedTransactionsCount: number;
  unmatchedOrphanDepositsCount: number;
  discrepanciesDetected: Array<{
    referenceNumber: string;
    issue: 'AMOUNT_MISMATCH' | 'NAME_MISMATCH' | 'DUPLICATE_REFERENCE' | 'UNREGISTERED_INBOUND';
    bankAmount: number;
    orderAmount?: number;
  }>;
  autoReconciliationRatePct: number;
  status: 'RECONCILIATION_BALANCED' | 'DISCREPANCIES_FLAGGED';
}

export interface ServiceHealthInput {
  webSocketLatencyMs: number;
  bankApiUptimePct: number;
  dbQueryResponseTimeMs: number;
  unresolvedErrorsCount: number;
}

export interface ServiceHealthResult {
  healthScore: number;
  systemStatus: 'OPTIMAL' | 'DEGRADED' | 'CIRCUIT_BREAKER_TRIGGERED';
  activeIncidentsCount: number;
  diagnosticAdvice: string;
  fallbackActionEngaged: boolean;
}

export interface IncidentTriageInput {
  incidentType: 'BANK_ACCOUNT_HOLD' | 'THIRD_PARTY_PAYMENT' | 'PARTIAL_PAYMENT_FRAUD' | 'APP_LATENCY_DELAY';
  amountAtRiskUsdt: number;
  orderId?: string;
  counterpartyAlias?: string;
}

export interface IncidentTriageResult {
  severityLevel: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MODERATE' | 'P4_LOW';
  maxResolutionSlaMinutes: number;
  requiresHumanHandoff: boolean;
  isolationProtocol: string;
  recommendedRemediationSteps: string[];
}

export interface SopAuditInput {
  orderId: string;
  accountHolderMatchesDocument: boolean;
  bankBalanceConfirmedInAvailableFunds: boolean;
  responseTimeMinutes: number;
  fundsReleasedBeforeBankVerification: boolean;
}

export interface SopAuditResult {
  isCompliant: boolean;
  complianceScore: number;
  violationsDetected: string[];
  disciplinaryAction: 'NONE' | 'FORMAL_WARNING' | 'OPERATOR_DESK_SUSPENSION';
  summary: string;
}

export interface GoogleSheetsSyncInput {
  tradeDate: string;
  orderId: string;
  counterpartyAlias: string;
  tradeType: 'BUY' | 'SELL';
  cryptoAmountUsdt: number;
  fiatAmountVes: number;
  exchangeRate: number;
  platformFeeUsdt: number;
  bankTransferFeeVes: number;
}

export interface GoogleSheetsSyncResult {
  rowValues: (string | number)[];
  calculatedGrossProfitUsdt: number;
  calculatedNetMarginPct: number;
  formulaGrossProfit: string;
  formulaNetSpreadPct: string;
  rowHash: string;
}

export interface CashFlowForecastInput {
  fiatBankBalancesTotalUsdtEquiv: number;
  cryptoExchangeBalancesUsdt: number;
  pendingUnsettledOrdersUsdt: number;
  dailyProjectedVolumeUsdt: number;
  averageOperationalExpensesDailyUsdt: number;
}

export interface CashFlowForecastResult {
  totalConsolidatedTreasuryUsdt: number;
  fiatLiquidityRatioPct: number;
  runwayOperationalDays: number;
  rebalanceRequired: boolean;
  recommendedUsdtReorderAmount: number;
  treasuryHealthVerdict: 'EXCELLENT_LIQUIDITY' | 'NEEDS_FIAT_REBALANCING' | 'CRITICAL_RUNWAY_DEFICIT';
}

// ---------------------------------------------------------------------------
// 1. Qualify Direct Lead and Close
// ---------------------------------------------------------------------------
export function qualifyDirectLeadAndClose(
  input: DirectLeadQualificationInput
): DirectLeadQualificationResult {
  const vol = Math.max(0, input.estimatedWeeklyVolumeUsdt);
  const rate = Math.max(0.01, input.currentParallelRate);

  let score = 50;
  if (vol >= 5000) score += 30;
  else if (vol >= 1000) score += 15;
  else score += 5;

  if (input.isKycVerified) score += 20;
  else score -= 15;

  let leadTier: 'VIP_COMMERCIAL' | 'RETAIL_TRADER' | 'HIGH_RISK_SUSPECT';
  let recommendedNetMarginBps = 120;
  let actionProtocol: 'ONBOARD_IMMEDIATELY' | 'REQUEST_IDENTITY_VERIFICATION' | 'DECLINE_HIGH_RISK';

  if (score >= 80) {
    leadTier = 'VIP_COMMERCIAL';
    recommendedNetMarginBps = 75; // 0.75% for high volume
    actionProtocol = 'ONBOARD_IMMEDIATELY';
  } else if (score >= 45) {
    leadTier = 'RETAIL_TRADER';
    recommendedNetMarginBps = 140; // 1.40% standard retail margin
    actionProtocol = input.isKycVerified ? 'ONBOARD_IMMEDIATELY' : 'REQUEST_IDENTITY_VERIFICATION';
  } else {
    leadTier = 'HIGH_RISK_SUSPECT';
    recommendedNetMarginBps = 250;
    actionProtocol = 'DECLINE_HIGH_RISK';
  }

  const quotedRate = Number((rate * (1 + recommendedNetMarginBps / 10000)).toFixed(2));

  let objectionHandlingScript = '';
  switch (input.primaryConcern) {
    case 'SECURITY':
      objectionHandlingScript = 'Entiendo perfectamente tu prioridad. Operamos como mesa institucional con cuentas jurídicas propias verificadas, sin intermediarios de terceros ni triangulaciones que pongan en riesgo tus cuentas bancarias.';
      break;
    case 'SPEED':
      objectionHandlingScript = 'Liquidamos de inmediato vía Banesco y Pago Móvil interbancario en menos de 4 minutos una vez confirmados los fondos.';
      break;
    case 'PRICE':
      objectionHandlingScript = `Para tu volumen proyectado de $${vol} USDT semanales te ofrecemos tasa preferencial fija de ${quotedRate} VES, garantizándote liquidez completa en un solo ticket sin fragmentación.`;
      break;
    default:
      objectionHandlingScript = 'Contamos con límites transaccionales corporativos ampliados para procesar tu orden en una única operación limpia.';
  }

  return {
    qualificationScore: score,
    leadTier,
    recommendedNetMarginBps,
    quotedRate,
    objectionHandlingScript,
    actionProtocol,
  };
}

// ---------------------------------------------------------------------------
// 2. Generate Social Traffic Funnel
// ---------------------------------------------------------------------------
export function generateSocialTrafficFunnel(
  input: SocialContentFunnelInput
): SocialContentFunnelResult {
  const gap = Number(input.currentBcvGapPct.toFixed(1));
  let hook = '';
  let body = '';
  let cta = '';
  let targetConversion = 2.5;

  if (input.educationalTheme === 'INFLATION_HEDGE') {
    hook = `⚠️ ¿Por qué retener bolívares más de 45 minutos te cuesta hasta un 8% semanal?`;
    body = `Con una brecha cambiaria en ${gap}%, los comercios minoristas están protegiendo su inventario dolarizándose inmediatamente al cerrar caja. En este video te mostramos el protocolo paso a paso para resguardar tus ventas sin perder en comisiones bancarias.`;
    cta = `Escribinos "PROTECCIÓN" por DM para acceder a nuestra guía de cobertura cambiaria y cotizar sin comisiones ocultas.`;
    targetConversion = 3.2;
  } else if (input.educationalTheme === 'AVOID_BANK_FREEZES') {
    hook = `🛑 3 Errores de novato en P2P que activan alertas en SUDEBAN y bloquean tu cuenta bancaria.`;
    body = `El 90% de los bloqueos preventivos no ocurren por el monto, sino por pagos de terceros y descripciones prohibidas en el concepto de transferencia. Aprendé la regla de oro para operar con cuentas limpias y comprobantes verificados.`;
    cta = `Sumate a nuestro canal privado de Telegram en el enlace del perfil para operar con comerciantes verificados.`;
    targetConversion = 4.0;
  } else {
    hook = `💡 Arbitraje Triangular Explicado: Cómo generar un spread neto del 1.2% combinando pares locales.`;
    body = `Cuando el mercado tiene alta dispersión de tasas, comprar y vender en el mismo libro deja poco margen. La verdadera rentabilidad institucional está en triangular entre métodos de pago profundos y liquidación rápida.`;
    cta = `Comentá "DESK" y te enviamos la calculadora de brecha en vivo de nuestra mesa de dinero.`;
    targetConversion = 3.5;
  }

  return {
    hookHeadline: hook,
    educationalBody: body,
    callToActionCta: cta,
    recommendedPostingWindow: input.platform === 'TIKTOK' ? '18:00 - 21:00 UTC-4' : '11:30 - 14:00 UTC-4',
    targetConversionRatePct: targetConversion,
  };
}

// ---------------------------------------------------------------------------
// 3. Benchmark Competitor Market Intelligence
// ---------------------------------------------------------------------------
export function benchmarkCompetitorMarketIntelligence(
  input: CompetitorBenchmarkInput
): CompetitorBenchmarkResult {
  const offers = input.competitorOffers;
  if (!offers || offers.length === 0) {
    return {
      marketMedianPrice: input.ourCurrentPrice,
      ourPositionInRank: 1,
      priceGapVsLeader: 0,
      isPriceCompetitive: true,
      underservedPaymentMethods: [],
      strategicRecommendation: 'Sin competidores directos en el libro. Mantener spread objetivo.',
    };
  }

  const sorted = [...offers].sort((a, b) =>
    input.targetSide === 'BUY' ? b.price - a.price : a.price - b.price
  );

  const prices = sorted.map((o) => o.price);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

  const leaderPrice = sorted[0].price;
  const priceGap = Math.abs(input.ourCurrentPrice - leaderPrice);

  let rank = 1;
  for (const c of sorted) {
    const isAhead = input.targetSide === 'BUY'
      ? c.price > input.ourCurrentPrice
      : c.price < input.ourCurrentPrice;
    if (isAhead) rank++;
  }

  const isPriceCompetitive = rank <= 3;

  // Search for underserved payment methods
  const methodCounts: Record<string, number> = {};
  for (const o of offers) {
    for (const m of o.paymentMethods) {
      methodCounts[m] = (methodCounts[m] || 0) + 1;
    }
  }

  const underservedPaymentMethods: string[] = [];
  for (const [m, count] of Object.entries(methodCounts)) {
    if (count <= 2) underservedPaymentMethods.push(m);
  }

  const recommendation = isPriceCompetitive
    ? `Posición #${rank} óptima en punta. El spread respeta el margen mínimo del ${input.ourMinMarginPct}%.`
    : `Posición #${rank} rezagada frente al líder (${leaderPrice}). Reevaluar colocación sin romper la regla de oro.`;

  return {
    marketMedianPrice: Number(median.toFixed(2)),
    ourPositionInRank: rank,
    priceGapVsLeader: Number(priceGap.toFixed(2)),
    isPriceCompetitive,
    underservedPaymentMethods,
    strategicRecommendation: recommendation,
  };
}

// ---------------------------------------------------------------------------
// 4. Orchestrate Workspace Sync
// ---------------------------------------------------------------------------
export function orchestrateWorkspaceSync(
  input: WorkspaceSyncInput
): WorkspaceSyncResult {
  const priorityColor =
    input.urgencyLevel === 'CRITICAL'
      ? '#FF453A'
      : input.urgencyLevel === 'HIGH'
      ? '#FF9F0A'
      : '#30D158';

  const notionProps: Record<string, string> = {
    Title: `[${input.entityType}] ${input.referenceId}`,
    Priority: input.urgencyLevel,
    Assignee: input.operatorAssigned,
    Summary: input.summaryText,
    Timestamp: new Date().toISOString(),
  };

  const clickUpTags = [input.entityType.toLowerCase(), input.urgencyLevel.toLowerCase(), 'p2p-desk'];
  const trelloTitle = `🚨 [${input.urgencyLevel}] ${input.entityType}: ${input.referenceId}`;

  return {
    syncPayload: {
      event: `P2P_EVENT_${input.entityType}`,
      reference: input.referenceId,
      priorityColor,
      notionProperties: notionProps,
      clickUpTags,
      trelloCardTitle: trelloTitle,
    },
    deliveryTimestamp: Date.now(),
    retryPolicy: {
      maxRetries: 3,
      backoffSeconds: 5,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Execute Desktop RPA Reconciliation
// ---------------------------------------------------------------------------
export function executeDesktopRpaReconciliation(
  input: DesktopRpaInput
): DesktopRpaResult {
  const statements = input.rawBankStatements || [];
  const orders = input.registeredP2pOrders || [];

  let matched = 0;
  let orphans = 0;
  const discrepancies: DesktopRpaResult['discrepanciesDetected'] = [];

  const orderMap = new Map<string, (typeof orders)[0]>();
  for (const o of orders) {
    orderMap.set(o.expectedBankReference.trim().toUpperCase(), o);
  }

  for (const stmt of statements) {
    const ref = stmt.referenceNumber.trim().toUpperCase();
    const matchingOrder = orderMap.get(ref);

    if (!matchingOrder) {
      orphans++;
      discrepancies.push({
        referenceNumber: stmt.referenceNumber,
        issue: 'UNREGISTERED_INBOUND',
        bankAmount: stmt.amount,
      });
      continue;
    }

    if (Math.abs(stmt.amount - matchingOrder.expectedAmountFiat) > 0.05) {
      discrepancies.push({
        referenceNumber: stmt.referenceNumber,
        issue: 'AMOUNT_MISMATCH',
        bankAmount: stmt.amount,
        orderAmount: matchingOrder.expectedAmountFiat,
      });
      continue;
    }

    matched++;
  }

  const rate = statements.length > 0 ? (matched / statements.length) * 100 : 100;

  return {
    totalStatementsParsed: statements.length,
    matchedTransactionsCount: matched,
    unmatchedOrphanDepositsCount: orphans,
    discrepanciesDetected: discrepancies,
    autoReconciliationRatePct: Number(rate.toFixed(1)),
    status: discrepancies.length === 0 ? 'RECONCILIATION_BALANCED' : 'DISCREPANCIES_FLAGGED',
  };
}

// ---------------------------------------------------------------------------
// 6. Monitor Service Health and Fallback
// ---------------------------------------------------------------------------
export function monitorServiceHealthAndFallback(
  input: ServiceHealthInput
): ServiceHealthResult {
  let score = 100;
  if (input.webSocketLatencyMs > 1000) score -= 25;
  else if (input.webSocketLatencyMs > 400) score -= 10;

  if (input.bankApiUptimePct < 95) score -= 30;
  else if (input.bankApiUptimePct < 99) score -= 10;

  if (input.dbQueryResponseTimeMs > 200) score -= 15;
  if (input.unresolvedErrorsCount > 0) score -= Math.min(30, input.unresolvedErrorsCount * 10);

  score = Math.max(0, Math.min(100, score));

  let systemStatus: 'OPTIMAL' | 'DEGRADED' | 'CIRCUIT_BREAKER_TRIGGERED';
  let fallback = false;
  let advice = '';

  if (score >= 80) {
    systemStatus = 'OPTIMAL';
    fallback = false;
    advice = 'Todos los subsistemas operando bajo parámetros normales.';
  } else if (score >= 50) {
    systemStatus = 'DEGRADED';
    fallback = false;
    advice = 'Latencia elevada detectada en feeds de precios o APIs bancarias. Reducir ritmo de rotación.';
  } else {
    systemStatus = 'CIRCUIT_BREAKER_TRIGGERED';
    fallback = true;
    advice = 'Degradación crítica del sistema. Circuit Breaker activado preventivamente para evitar descalces.';
  }

  return {
    healthScore: score,
    systemStatus,
    activeIncidentsCount: input.unresolvedErrorsCount,
    diagnosticAdvice: advice,
    fallbackActionEngaged: fallback,
  };
}

// ---------------------------------------------------------------------------
// 7. Triage Incident and Escalate
// ---------------------------------------------------------------------------
export function triageIncidentAndEscalate(
  input: IncidentTriageInput
): IncidentTriageResult {
  let severity: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MODERATE' | 'P4_LOW';
  let slaMinutes = 15;
  let requiresHuman = true;
  let protocol = '';
  const remediation: string[] = [];

  switch (input.incidentType) {
    case 'BANK_ACCOUNT_HOLD':
      severity = 'P1_CRITICAL';
      slaMinutes = 10;
      requiresHuman = true;
      protocol = 'PROTOCOLO_DEFENSA_BANCARIA_P1: Pausar inmediatamente anuncios vinculados a la cuenta afectada y solicitar estado de cuenta formal al banco.';
      remediation.push('Desactivar cuenta bancaria en el selector de métodos.');
      remediation.push('Derivar órdenes activas a cuenta de contingencia pre-autorizada.');
      remediation.push('Generar export de comprobantes y órdenes asociadas.');
      break;

    case 'THIRD_PARTY_PAYMENT':
      severity = 'P2_HIGH';
      slaMinutes = 20;
      requiresHuman = true;
      protocol = 'PROTOCOLO_PAGO_TERCERO_P2: Retención preventiva de criptoactivos. Prohibido liberar fondos.';
      remediation.push('Solicitar en el chat que el titular original confirme identidad o proceda con la reversión inmediata.');
      remediation.push('No liberar USDT bajo ninguna circunstancia sin autorización del CSO.');
      remediation.push('Preparar expediente en Dispute Copilot con captura de comprobante.');
      break;

    case 'PARTIAL_PAYMENT_FRAUD':
      severity = 'P2_HIGH';
      slaMinutes = 25;
      requiresHuman = true;
      protocol = 'PROTOCOLO_PAGO_INCOMPLETO_P2: Notificar monto exacto faltante y retener fondos.';
      remediation.push('Informar saldo restante al comprador en el chat.');
      remediation.push('Esperar complemento o gestionar devolución deduciendo comisiones.');
      break;

    default:
      severity = 'P4_LOW';
      slaMinutes = 60;
      requiresHuman = false;
      protocol = 'PROTOCOLO_MONITOREO_ESTÁNDAR_P4: Registro en logs y reintento de sincronización.';
      remediation.push('Verificar conectividad de red y reintentar operación.');
  }

  return {
    severityLevel: severity,
    maxResolutionSlaMinutes: slaMinutes,
    requiresHumanHandoff: requiresHuman,
    isolationProtocol: protocol,
    recommendedRemediationSteps: remediation,
  };
}

// ---------------------------------------------------------------------------
// 8. Audit SOP Compliance Enforcement
// ---------------------------------------------------------------------------
export function auditSopComplianceEnforcement(
  input: SopAuditInput
): SopAuditResult {
  const violations: string[] = [];
  let score = 100;

  if (input.fundsReleasedBeforeBankVerification) {
    violations.push('VIOLACIÓN GRAVE: Criptoactivos liberados sin confirmación directa en cuenta bancaria (Saldo Disponible).');
    score -= 60;
  }

  if (!input.accountHolderMatchesDocument) {
    violations.push('VIOLACIÓN CRÍTICA: Orden procesada con titular bancario no coincidente con el documento verificado en Binance.');
    score -= 35;
  }

  if (!input.bankBalanceConfirmedInAvailableFunds) {
    violations.push('VIOLACIÓN DE RIESGO: Se aceptó saldo en tránsito o retenido sin confirmar saldo disponible líquido.');
    score -= 20;
  }

  if (input.responseTimeMinutes > 15) {
    violations.push('DEMORA OPERATIVA: Tiempo de atención excedió el SLA máximo de 15 minutos.');
    score -= 10;
  }

  score = Math.max(0, score);
  const isCompliant = violations.length === 0;

  let disciplinaryAction: 'NONE' | 'FORMAL_WARNING' | 'OPERATOR_DESK_SUSPENSION';
  if (score >= 90) disciplinaryAction = 'NONE';
  else if (score >= 50) disciplinaryAction = 'FORMAL_WARNING';
  else disciplinaryAction = 'OPERATOR_DESK_SUSPENSION';

  const summary = isCompliant
    ? `Auditoría SOP aprobada al 100% para orden ${input.orderId}. Protocolos de seguridad estrictamente cumplidos.`
    : `Auditoría SOP reprobada (${violations.length} infracciones detectadas). Acción: ${disciplinaryAction}.`;

  return {
    isCompliant,
    complianceScore: score,
    violationsDetected: violations,
    disciplinaryAction,
    summary,
  };
}

// ---------------------------------------------------------------------------
// 9. Sync Google Sheets Live Ledger
// ---------------------------------------------------------------------------
export function syncGoogleSheetsLiveLedger(
  input: GoogleSheetsSyncInput
): GoogleSheetsSyncResult {
  const grossProfitUsdt =
    input.tradeType === 'SELL'
      ? input.cryptoAmountUsdt * (input.exchangeRate / (input.exchangeRate * 0.985) - 1)
      : input.cryptoAmountUsdt * 0.015;

  const netMarginPct =
    input.cryptoAmountUsdt > 0
      ? ((grossProfitUsdt - input.platformFeeUsdt) / input.cryptoAmountUsdt) * 100
      : 0;

  const formulaGross = `=IF(D2="SELL", (F2/H2)-E2, E2*0.015)`;
  const formulaNet = `=(I2-G2)/E2*100`;

  const rowValues = [
    input.tradeDate,
    input.orderId,
    input.counterpartyAlias,
    input.tradeType,
    input.cryptoAmountUsdt,
    input.fiatAmountVes,
    input.exchangeRate,
    input.platformFeeUsdt,
    formulaGross,
    formulaNet,
  ];

  const rowHash = `${input.orderId}_${input.tradeType}_${input.cryptoAmountUsdt}`;

  return {
    rowValues,
    calculatedGrossProfitUsdt: Number(grossProfitUsdt.toFixed(2)),
    calculatedNetMarginPct: Number(netMarginPct.toFixed(2)),
    formulaGrossProfit: formulaGross,
    formulaNetSpreadPct: formulaNet,
    rowHash,
  };
}

// ---------------------------------------------------------------------------
// 10. Forecast Cash Flow and Reconciliation
// ---------------------------------------------------------------------------
export function forecastCashFlowAndReconciliation(
  input: CashFlowForecastInput
): CashFlowForecastResult {
  const fiat = Math.max(0, input.fiatBankBalancesTotalUsdtEquiv);
  const crypto = Math.max(0, input.cryptoExchangeBalancesUsdt);
  const pending = Math.max(0, input.pendingUnsettledOrdersUsdt);
  const total = fiat + crypto + pending;

  const fiatRatio = total > 0 ? (fiat / total) * 100 : 0;
  const burnDaily = Math.max(10, input.averageOperationalExpensesDailyUsdt);
  const runway = burnDaily > 0 ? total / burnDaily : 999;

  let verdict: 'EXCELLENT_LIQUIDITY' | 'NEEDS_FIAT_REBALANCING' | 'CRITICAL_RUNWAY_DEFICIT';
  let rebalance = false;
  let reorderUsdt = 0;

  if (fiatRatio > 35) {
    verdict = 'NEEDS_FIAT_REBALANCING';
    rebalance = true;
    reorderUsdt = fiat - total * 0.15; // Target fiat ratio 15%
  } else if (runway < 7) {
    verdict = 'CRITICAL_RUNWAY_DEFICIT';
    rebalance = true;
    reorderUsdt = 0;
  } else {
    verdict = 'EXCELLENT_LIQUIDITY';
    rebalance = false;
    reorderUsdt = 0;
  }

  return {
    totalConsolidatedTreasuryUsdt: Number(total.toFixed(2)),
    fiatLiquidityRatioPct: Number(fiatRatio.toFixed(1)),
    runwayOperationalDays: Number(runway.toFixed(1)),
    rebalanceRequired: rebalance,
    recommendedUsdtReorderAmount: Number(Math.max(0, reorderUsdt).toFixed(2)),
    treasuryHealthVerdict: verdict,
  };
}
