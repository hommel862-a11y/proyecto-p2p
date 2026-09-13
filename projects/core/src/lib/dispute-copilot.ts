/**
 * Dispute Copilot & Real-Time Negotiation Engine.
 * Generates structured, arbitration-grade appeal dossiers and counterparty chat responses
 * for Binance P2P dispute settlement (specifically targeting third-party payments,
 * triangular scams, and amount/reference discrepancies).
 * Pure TypeScript, framework-agnostic, zero external dependencies.
 */

import { type FraudShieldAuditResult } from './fraud-shield';
import { type FsmOrderContext } from './fsm';

export interface DisputeDossierParams {
  orderId: string;
  orderAmountFiat: number;
  orderAmountCrypto: number;
  fiatCurrency?: string;
  cryptoAsset?: string;
  counterpartyBinanceName: string;
  counterpartyBinanceIdDoc?: string;
  bankPayerName?: string;
  bankPayerIdDoc?: string;
  bankName: string;
  bankReference: string;
  bankPaymentTimestamp: number;
  orderCreatedTimestamp: number;
  fraudAudit: FraudShieldAuditResult;
  operatorNotes?: string;
}

export interface DisputeTimelineEvent {
  time: string;
  timestamp: number;
  title: string;
  description: string;
  category: 'ORDER' | 'BANK' | 'FORENSIC' | 'ACTION';
}

export interface DisputeDossier {
  caseId: string;
  generatedAt: number;
  orderId: string;
  severity: 'HIGH' | 'CRITICAL';
  primaryReason: string;
  timeline: DisputeTimelineEvent[];
  appealTextEs: string;
  appealTextEn: string;
  chatResponses: {
    thirdPartyWarning: string;
    refundInstructions: string;
    appealEscalation: string;
  };
  evidenceSummary: {
    expectedName: string;
    actualPayerName: string;
    nameSimilarityPct: number;
    reference: string;
    bank: string;
    riskScore: number;
    flags: string[];
  };
}

/**
 * Generates an official, arbitration-grade Binance P2P Dispute Dossier.
 */
export function buildDisputeDossier(params: DisputeDossierParams): DisputeDossier {
  const fiat = params.fiatCurrency || 'VES';
  const crypto = params.cryptoAsset || 'USDT';
  const now = Date.now();
  const caseId = `DSP-${params.orderId}-${now.toString().slice(-4)}`;

  const orderTimeStr = new Date(params.orderCreatedTimestamp).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const bankTimeStr = new Date(params.bankPaymentTimestamp).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const auditTimeStr = new Date(now).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const nameMatchPct = Math.round(params.fraudAudit.nameMatch.score * 100);
  const actualName = params.bankPayerName || 'No identificado / Desconocido';
  const expectedName = params.counterpartyBinanceName;

  // 1. Línea temporal forense
  const timeline: DisputeTimelineEvent[] = [
    {
      time: orderTimeStr,
      timestamp: params.orderCreatedTimestamp,
      title: 'Creación de Orden P2P',
      description: `Orden iniciada por ${expectedName} por un monto de ${params.orderAmountFiat.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ${fiat} (${params.orderAmountCrypto} ${crypto}).`,
      category: 'ORDER',
    },
    {
      time: bankTimeStr,
      timestamp: params.bankPaymentTimestamp,
      title: 'Recepción de Transferencia Bancaria',
      description: `Acreditación bancaria registrada en ${params.bankName} con referencia #${params.bankReference}. Titular emisor reportado: "${actualName}".`,
      category: 'BANK',
    },
    {
      time: auditTimeStr,
      timestamp: now,
      title: 'Peritaje Forense Anti-Fraude',
      description: `Escudo Forense detectó discrepancia de titularidad (${nameMatchPct}% coincidencia). Flags: [${params.fraudAudit.flags.join(', ')}]. Riesgo: ${params.fraudAudit.riskLevel} (${params.fraudAudit.overallScore}/100).`,
      category: 'FORENSIC',
    },
    {
      time: auditTimeStr,
      timestamp: now,
      title: 'Retención Preventiva & Apertura de Disputa',
      description: 'Fondos en criptoactivos retenidos en custodia preventiva conforme a las políticas de Binance contra pagos de terceros.',
      category: 'ACTION',
    },
  ];

  // 2. Escrito formal de apelación en Español
  const appealTextEs = `EXPEDIENTE DE APELACIÓN FORMAL — BINANCE P2P ARBITRATION
Número de Orden: ${params.orderId}
Fecha y Hora de Operación: ${new Date(params.orderCreatedTimestamp).toISOString()}
Monto: ${params.orderAmountFiat.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ${fiat} / ${params.orderAmountCrypto} ${crypto}

1. MOTIVO DE LA APELACIÓN:
Violación estricta de los Términos y Condiciones del Servicio Binance P2P (Sección: Prohibición de Pagos de Terceros / Third-Party Payment Policy).

2. DETALLE DE LAS PARTES Y EVIDENCIA:
• Nombre Verificado en Binance: ${expectedName}${params.counterpartyBinanceIdDoc ? ` (Doc: ${params.counterpartyBinanceIdDoc})` : ''}
• Titular de la Cuenta Bancaria Emisora: ${actualName}${params.bankPayerIdDoc ? ` (Doc: ${params.bankPayerIdDoc})` : ''}
• Banco Emisor: ${params.bankName}
• Referencia Bancaria: ${params.bankReference}
• Índice de Coincidencia de Identidad: ${nameMatchPct}% (INCONSISTENCIA EVIDENTE)
• Alertas Forenses Activas: ${params.fraudAudit.flags.join(', ')}

3. ALEGATO LEGAL:
El comprador verificó su cuenta bajo la identidad de "${expectedName}", pero los fondos fueron transferidos desde una cuenta perteneciente a "${actualName}". Esta práctica representa un riesgo de estafa triangular ("Triangular Scam") y fraude bancario por suplantación de identidad.

Conforme a la Política de Resolución de Disputas de Binance, el vendedor NO está obligado a liberar criptoactivos a cuentas no coincidentes con el KYC del usuario.

4. PETICIÓN CONCRETA AL ÁRBITRO DE BINANCE:
1) Declarar fundada esta apelación y autorizar la retención de los criptoactivos en custodia.
2) Exigir al comprador que confirme los datos de origen para realizar el reembolso inmediato de los fondos bancarios, deducidas las comisiones aplicables.
3) Proceder con la cancelación de la orden sin penalización de tasa de finalización para mi cuenta comercial.`;

  // 3. Escrito formal de apelación en Inglés (estándar para árbitros internacionales)
  const appealTextEn = `FORMAL ARBITRATION APPEAL DOSSIER — BINANCE P2P
Order Number: ${params.orderId}
Timestamp: ${new Date(params.orderCreatedTimestamp).toISOString()}
Trade Value: ${params.orderAmountFiat.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${fiat} / ${params.orderAmountCrypto} ${crypto}

1. GROUND FOR DISPUTE:
Strict violation of Binance P2P User Agreement (Clause: Mandatory KYC Bank-Account Match / Third-Party Payment Prohibition).

2. EVIDENCE BREAKDOWN:
• Verified Binance Account Name: ${expectedName}
• Bank Account Sender Name: ${actualName}
• Bank Institution: ${params.bankName}
• Transaction Reference: ${params.bankReference}
• Identity Match Score: ${nameMatchPct}% (CRITICAL MISMATCH)
• Detected Flags: ${params.fraudAudit.flags.join(', ')}

3. STATEMENT OF FACTS:
The counterparty's verified Binance identity is "${expectedName}", whereas the incoming fiat deposit originates from an unrelated account owned by "${actualName}". This pattern constitutes a severe Third-Party Payment violation and carries immediate risk of triangular fraud or unauthorized payment claims.

Per Binance P2P Merchant Guidelines, sellers must NEVER release cryptocurrency to third-party remitters.

4. REQUESTED ARBITRATION ORDER:
1) Uphold this dispute in favor of the seller and maintain crypto escrow locked.
2) Instruct the buyer to provide origin account details for a full refund of fiat funds (minus standard interbank transfer fees).
3) Cancel the order without affecting the seller's completion rate.`;

  // 4. Respuestas rápidas para el chat del operador
  const chatResponses = {
    thirdPartyWarning: `⚠️ AVISO DE SEGURIDAD P2P: Estimado usuario, el pago recibido por ${params.orderAmountFiat} ${fiat} proviene de una cuenta a nombre de "${actualName}", la cual NO coincide con su titular verificado en Binance ("${expectedName}"). Por políticas de Binance y prevención de fraude bancario, no está permitido liberar criptoactivos a pagos de terceros.`,
    refundInstructions: `🔄 INSTRUCCIONES DE REEMBOLSO: Por favor suministre los datos bancarios exactos de la cuenta emisora (${actualName}) para reversar inmediatamente el dinero recibido, deduciendo únicamente la comisión de transferencia interbancaria. Una vez reembolsado, usted cancelará la orden.`,
    appealEscalation: `🚨 CASO EN ARBITRAJE: Debido a la discrepancia de identidad no autorizada, este caso ha sido elevado a los árbitros de Binance con el expediente #${caseId}. La custodia permanecerá asegurada hasta la resolución formal del mediador de Binance.`,
  };

  return {
    caseId,
    generatedAt: now,
    orderId: params.orderId,
    severity: params.fraudAudit.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    primaryReason: params.fraudAudit.flags.includes('THIRD_PARTY_PAYER')
      ? 'Pago realizado por titular tercero no verificado'
      : 'Inconsistencia en comprobante y datos de transferencia',
    timeline,
    appealTextEs,
    appealTextEn,
    chatResponses,
    evidenceSummary: {
      expectedName,
      actualPayerName: actualName,
      nameSimilarityPct: nameMatchPct,
      reference: params.bankReference,
      bank: params.bankName,
      riskScore: params.fraudAudit.overallScore,
      flags: params.fraudAudit.flags,
    },
  };
}

/**
 * Builds a Dispute Dossier directly from an active FSM Order Context and Fraud Audit.
 */
export function buildDisputeDossierFromFsm(
  fsm: FsmOrderContext,
  fraudAudit: FraudShieldAuditResult,
  operatorNotes?: string,
): DisputeDossier {
  return buildDisputeDossier({
    orderId: fsm.orderId,
    orderAmountFiat: fsm.amountFiat,
    orderAmountCrypto: fsm.amountCrypto,
    fiatCurrency: fsm.fiat,
    cryptoAsset: fsm.asset,
    counterpartyBinanceName: fsm.counterpartyName,
    counterpartyBinanceIdDoc: fsm.counterpartyIdDoc,
    bankPayerName: fsm.bankPayment?.payerName,
    bankPayerIdDoc: fsm.bankPayment?.payerIdDoc,
    bankName: fsm.bankPayment?.bank || 'Banca Nacional',
    bankReference: fsm.bankPayment?.reference || 'Sin Ref',
    bankPaymentTimestamp: fsm.bankPayment?.timestamp || Date.now(),
    orderCreatedTimestamp: fsm.createdAt,
    fraudAudit,
    operatorNotes,
  });
}
