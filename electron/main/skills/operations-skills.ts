/**
 * Operations & Forensic Compliance Skills: Dispute Dossiers, OCR Audit, RPA, SOP & Sheets Sync.
 */

import type { AgentSkillDefinition, FinancialSkillResult } from './types';
import { normalizeBankToType } from './types';
import { evaluateFraudRisk, type FraudShieldAuditResult } from '../vendor/p2p-core/fraud-shield';
import { buildDisputeDossier } from '../vendor/p2p-core/dispute-copilot';
import { parseBankReceiptText } from '../vendor/p2p-core/receipt-ocr';
import {
  qualifyDirectLeadAndClose,
  generateSocialTrafficFunnel,
  benchmarkCompetitorMarketIntelligence,
  orchestrateWorkspaceSync,
  executeDesktopRpaReconciliation,
  monitorServiceHealthAndFallback,
  triageIncidentAndEscalate,
  auditSopComplianceEnforcement,
  syncGoogleSheetsLiveLedger,
  forecastCashFlowAndReconciliation,
} from '../vendor/p2p-core/operations-workflow';

export const OPERATIONS_SKILLS_DEFINITIONS: AgentSkillDefinition[] = [
  {
    name: 'generate_dispute_dossier',
    description:
      'Construye un expediente formal y arbitral bilingüe (español/inglés) para mediar en disputas P2P de Binance por pagos de terceros o discrepancias.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: {
          type: 'STRING',
          description: 'ID oficial de la orden P2P en Binance.',
        },
        orderAmountFiat: {
          type: 'NUMBER',
          description: 'Monto en fiat esperado en la orden.',
        },
        orderAmountCrypto: {
          type: 'NUMBER',
          description: 'Monto en USDT comprometido.',
        },
        counterpartyBinanceName: {
          type: 'STRING',
          description: 'Nombre del titular de la cuenta en Binance.',
        },
        bankPayerName: {
          type: 'STRING',
          description: 'Nombre real del pagador bancario.',
        },
        bankName: {
          type: 'STRING',
          description: 'Banco emisor.',
        },
        bankReference: {
          type: 'STRING',
          description: 'Referencia bancaria.',
        },
      },
      required: [
        'orderId',
        'orderAmountFiat',
        'orderAmountCrypto',
        'counterpartyBinanceName',
        'bankPayerName',
        'bankName',
        'bankReference',
      ],
    },
  },
  {
    name: 'audit_payment_proof_ocr',
    description:
      'Auditoría forense de texto extraído de comprobantes bancarios (OCR) para validar montos, números de referencia, concordancia de nombres y prevención de triangulación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ocrText: {
          type: 'STRING',
          description: 'Texto plano obtenido del comprobante o captura de pantalla.',
        },
        expectedAmountVes: {
          type: 'NUMBER',
          description: 'Monto en bolívares esperado de la orden.',
        },
        expectedReference: {
          type: 'STRING',
          description: 'Número de referencia bancaria esperado.',
        },
        expectedPayerName: {
          type: 'STRING',
          description: 'Nombre completo verificado de la contraparte en Binance.',
        },
      },
      required: ['ocrText'],
    },
  },
  {
    name: 'qualify_direct_lead_and_close',
    description:
      'Califica prospectos comerciales de WhatsApp/Telegram (ticket, frecuencia, verificación KYC y objeciones) y genera la cotización personalizada con margen institucional.',
    parameters: {
      type: 'OBJECT',
      properties: {
        leadChannel: {
          type: 'STRING',
          enum: ['WHATSAPP', 'TELEGRAM', 'INSTAGRAM_DM'],
          description: 'Canal de entrada del prospecto.',
        },
        estimatedWeeklyVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen semanal estimado en USDT.',
        },
        paymentMethodPreferred: { type: 'STRING', description: 'Método de pago preferido.' },
        isKycVerified: {
          type: 'BOOLEAN',
          description: 'Si el cliente ya entregó documento de identidad verificado.',
        },
        primaryConcern: {
          type: 'STRING',
          enum: ['PRICE', 'SECURITY', 'SPEED', 'PAYMENT_LIMITS'],
          description: 'Principal objeción o prioridad del cliente.',
        },
        currentParallelRate: {
          type: 'NUMBER',
          description: 'Tasa de cambio paralela spot en VES.',
        },
      },
      required: [
        'leadChannel',
        'estimatedWeeklyVolumeUsdt',
        'paymentMethodPreferred',
        'isKycVerified',
        'primaryConcern',
        'currentParallelRate',
      ],
    },
  },
  {
    name: 'generate_social_traffic_funnel',
    description:
      'Diseña guiones y contenido educativo de arbitraje y resguardo contra la inflación para redes sociales, orientando tráfico orgánico a la mesa P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAudience: {
          type: 'STRING',
          enum: ['RETAIL_SAVERS', 'MERCHANT_IMPORTERS', 'P2P_ARBITRAGEURS'],
          description: 'Audiencia objetivo.',
        },
        platform: {
          type: 'STRING',
          enum: ['INSTAGRAM', 'TIKTOK', 'TWITTER_X'],
          description: 'Plataforma social de publicación.',
        },
        currentBcvGapPct: { type: 'NUMBER', description: 'Brecha actual del BCV en porcentaje.' },
        educationalTheme: {
          type: 'STRING',
          enum: ['INFLATION_HEDGE', 'TRIANGULATION_BASICS', 'AVOID_BANK_FREEZES'],
          description: 'Eje temático.',
        },
      },
      required: ['targetAudience', 'platform', 'currentBcvGapPct', 'educationalTheme'],
    },
  },
  {
    name: 'benchmark_competitor_market_intelligence',
    description:
      'Rastrea y compara precios, métodos de pago y calidad de servicio de competidores activos para optimizar el spread y encontrar nichos desatendidos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ourCurrentPrice: { type: 'NUMBER', description: 'Nuestro precio actual en el libro.' },
        targetSide: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Lado del libro.' },
        ourMinMarginPct: {
          type: 'NUMBER',
          description: 'Margen mínimo tolerado por la regla de oro.',
        },
        competitorOffers: {
          type: 'ARRAY',
          description: 'Lista de ofertas de competidores en el libro.',
          items: { type: 'OBJECT', description: 'Oferta competidora.' },
        },
      },
      required: ['ourCurrentPrice', 'targetSide', 'ourMinMarginPct', 'competitorOffers'],
    },
  },
  {
    name: 'orchestrate_workspace_sync',
    description:
      'Prepara y formatea cargas de eventos e incidencias críticas para sincronización con Notion, ClickUp o Trello mediante webhooks modulares.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entityType: {
          type: 'STRING',
          enum: ['ORDER', 'DISPUTE', 'BANK_INCIDENT', 'SOP_VIOLATION'],
          description: 'Tipo de entidad operativa.',
        },
        referenceId: { type: 'STRING', description: 'Identificador único de la entidad.' },
        urgencyLevel: {
          type: 'STRING',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          description: 'Nivel de urgencia.',
        },
        operatorAssigned: {
          type: 'STRING',
          description: 'Nombre del operador o agente responsable.',
        },
        summaryText: { type: 'STRING', description: 'Resumen descriptivo del evento.' },
      },
      required: ['entityType', 'referenceId', 'urgencyLevel', 'operatorAssigned', 'summaryText'],
    },
  },
  {
    name: 'execute_desktop_rpa_reconciliation',
    description:
      'Concilia de forma automatizada (RPA) extractos bancarios contra órdenes P2P registradas para detectar discrepancias de montos y depósitos huérfanos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bankName: { type: 'STRING', description: 'Nombre de la entidad bancaria.' },
        rawBankStatements: {
          type: 'ARRAY',
          description: 'Movimientos bancarios extraídos.',
          items: { type: 'OBJECT', description: 'Línea de extracto bancario.' },
        },
        registeredP2pOrders: {
          type: 'ARRAY',
          description: 'Órdenes P2P registradas en el sistema.',
          items: { type: 'OBJECT', description: 'Orden P2P esperada.' },
        },
      },
      required: ['bankName', 'rawBankStatements', 'registeredP2pOrders'],
    },
  },
  {
    name: 'monitor_service_health_and_fallback',
    description:
      'Supervisa la salud de sockets, base de datos y APIs bancarias, activando fallbacks preventivos si se degradan los parámetros de operación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        webSocketLatencyMs: {
          type: 'NUMBER',
          description: 'Latencia del WebSocket en milisegundos.',
        },
        bankApiUptimePct: {
          type: 'NUMBER',
          description: 'Disponibilidad de APIs bancarias en porcentaje.',
        },
        dbQueryResponseTimeMs: {
          type: 'NUMBER',
          description: 'Tiempo de respuesta de base de datos en ms.',
        },
        unresolvedErrorsCount: {
          type: 'INTEGER',
          description: 'Cantidad de errores no resueltos acumulados.',
        },
      },
      required: [
        'webSocketLatencyMs',
        'bankApiUptimePct',
        'dbQueryResponseTimeMs',
        'unresolvedErrorsCount',
      ],
    },
  },
  {
    name: 'triage_incident_and_escalate',
    description:
      'Clasifica incidencias y crisis operativas (P1 a P4), calcula SLAs de resolución y activa protocolos de aislamiento e intervención humana.',
    parameters: {
      type: 'OBJECT',
      properties: {
        incidentType: {
          type: 'STRING',
          enum: [
            'BANK_ACCOUNT_HOLD',
            'THIRD_PARTY_PAYMENT',
            'PARTIAL_PAYMENT_FRAUD',
            'APP_LATENCY_DELAY',
          ],
          description: 'Naturaleza de la incidencia.',
        },
        amountAtRiskUsdt: { type: 'NUMBER', description: 'Capital total en riesgo en USDT.' },
        orderId: { type: 'STRING', description: 'ID de la orden afectada si aplica.' },
      },
      required: ['incidentType', 'amountAtRiskUsdt'],
    },
  },
  {
    name: 'audit_sop_compliance_enforcement',
    description:
      'Audita el cumplimiento estricto de Protocolos Operativos Estándar (verificación de titular, comprobación en saldo disponible y tiempos de respuesta).',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'ID de la orden a auditar.' },
        accountHolderMatchesDocument: {
          type: 'BOOLEAN',
          description: 'Si el titular bancario coincide con la cuenta verificada.',
        },
        bankBalanceConfirmedInAvailableFunds: {
          type: 'BOOLEAN',
          description: 'Si el dinero está disponible y no retenido/diferido.',
        },
        responseTimeMinutes: {
          type: 'NUMBER',
          description: 'Minutos transcurridos hasta la atención.',
        },
        fundsReleasedBeforeBankVerification: {
          type: 'BOOLEAN',
          description: 'Si los fondos fueron liberados antes de verificar en banco.',
        },
      },
      required: [
        'orderId',
        'accountHolderMatchesDocument',
        'bankBalanceConfirmedInAvailableFunds',
        'responseTimeMinutes',
        'fundsReleasedBeforeBankVerification',
      ],
    },
  },
  {
    name: 'sync_google_sheets_live_ledger',
    description:
      'Formatea registros transaccionales para Google Sheets / Excel con fórmulas dinámicas de margen neto, comisiones y balances en tiempo real.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tradeDate: { type: 'STRING', description: 'Fecha de la operación (YYYY-MM-DD).' },
        orderId: { type: 'STRING', description: 'Número de orden.' },
        counterpartyAlias: { type: 'STRING', description: 'Alias de la contraparte.' },
        tradeType: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Tipo de operación.' },
        cryptoAmountUsdt: { type: 'NUMBER', description: 'Monto de cripto en USDT.' },
        fiatAmountVes: { type: 'NUMBER', description: 'Monto en bolívares fiat.' },
        exchangeRate: { type: 'NUMBER', description: 'Tasa pactada de cambio.' },
        platformFeeUsdt: { type: 'NUMBER', description: 'Comisión del exchange en USDT.' },
        bankTransferFeeVes: { type: 'NUMBER', description: 'Comisión bancaria en bolívares.' },
      },
      required: [
        'tradeDate',
        'orderId',
        'counterpartyAlias',
        'tradeType',
        'cryptoAmountUsdt',
        'fiatAmountVes',
        'exchangeRate',
        'platformFeeUsdt',
        'bankTransferFeeVes',
      ],
    },
  },
  {
    name: 'forecast_cash_flow_and_reconciliation',
    description:
      'Concilia balances fiat y cripto, detecta descuadres por comisiones bancarias y proyecta días de runway de tesorería para recompras de inventario.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fiatBankBalancesTotalUsdtEquiv: {
          type: 'NUMBER',
          description: 'Balance en bancos equivalente a USDT.',
        },
        cryptoExchangeBalancesUsdt: {
          type: 'NUMBER',
          description: 'Saldo en billeteras de exchange en USDT.',
        },
        pendingUnsettledOrdersUsdt: {
          type: 'NUMBER',
          description: 'Monto en órdenes pendientes de liquidar.',
        },
        dailyProjectedVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen diario promedio proyectado.',
        },
        averageOperationalExpensesDailyUsdt: {
          type: 'NUMBER',
          description: 'Gasto operativo diario promedio.',
        },
      },
      required: [
        'fiatBankBalancesTotalUsdtEquiv',
        'cryptoExchangeBalancesUsdt',
        'pendingUnsettledOrdersUsdt',
        'dailyProjectedVolumeUsdt',
        'averageOperationalExpensesDailyUsdt',
      ],
    },
  },
];

export function dispatchOperationsSkill(
  skillName: string,
  args: Record<string, unknown>,
  now: number,
): FinancialSkillResult | null {
  switch (skillName) {
    case 'generate_dispute_dossier': {
      const orderId = String(args['orderId'] || 'ORD-UNKNOWN');
      const orderAmountFiat = Number(args['orderAmountFiat'] || 0);
      const orderAmountCrypto = Number(args['orderAmountCrypto'] || 0);
      const counterparty = String(args['counterpartyBinanceName'] || 'Contraparte');
      const payer = String(args['bankPayerName'] || '');
      const bankName = String(args['bankName'] || '');
      const bankReference = String(args['bankReference'] || '');
      const bank = normalizeBankToType(bankName);

      const fraudAudit: FraudShieldAuditResult = evaluateFraudRisk({
        orderId,
        orderAmount: orderAmountFiat,
        orderCurrency: 'VES',
        advertiserVerifiedName: counterparty,
        receipt: {
          reference: bankReference,
          amount: orderAmountFiat,
          currency: 'VES',
          payerName: payer,
          bank,
          timestamp: new Date(now).toISOString(),
        },
        blacklistedReferences: [],
      });

      const dossier = buildDisputeDossier({
        orderId,
        orderAmountFiat,
        orderAmountCrypto,
        fiatCurrency: 'VES',
        cryptoAsset: 'USDT',
        counterpartyBinanceName: counterparty,
        bankPayerName: payer,
        bankName,
        bankReference,
        bankPaymentTimestamp: now,
        orderCreatedTimestamp: now,
        fraudAudit,
      });

      return {
        success: true,
        skillName,
        data: {
          ...dossier,
          forensics: {
            overallScore: fraudAudit.overallScore,
            riskLevel: fraudAudit.riskLevel,
            flags: fraudAudit.flags,
            recommendation: fraudAudit.recommendation,
            nameSimilarityPct: Math.round(fraudAudit.nameMatch.score * 100),
          },
          engine:
            'core/lib/fraud-shield#evaluateFraudRisk + core/lib/dispute-copilot#buildDisputeDossier',
        },
        executedAt: now,
      };
    }

    case 'audit_payment_proof_ocr': {
      const ocrText = String(args['ocrText'] ?? '');
      const expectedAmountVes =
        args['expectedAmountVes'] !== undefined ? Number(args['expectedAmountVes']) : undefined;
      const expectedReference = args['expectedReference']
        ? String(args['expectedReference'])
        : undefined;
      const expectedPayerName = args['expectedPayerName']
        ? String(args['expectedPayerName'])
        : undefined;

      const parsedReceipt = parseBankReceiptText(ocrText, {
        expectedCounterpartyName: expectedPayerName,
      });

      let amountMismatch = false;
      if (expectedAmountVes !== undefined && parsedReceipt.amount > 0) {
        amountMismatch = Math.abs(parsedReceipt.amount - expectedAmountVes) > 0.05;
      }

      let referenceMismatch = false;
      if (expectedReference && parsedReceipt.reference) {
        referenceMismatch =
          !parsedReceipt.reference.includes(expectedReference) &&
          !expectedReference.includes(parsedReceipt.reference);
      }

      const isSafe =
        !parsedReceipt.antiTriangulationAlert &&
        !amountMismatch &&
        !referenceMismatch &&
        parsedReceipt.confidenceScore >= 0.5;

      return {
        success: true,
        skillName,
        data: {
          receipt: parsedReceipt,
          isSafe,
          auditFindings: {
            amountMatches: !amountMismatch,
            referenceMatches: !referenceMismatch,
            antiTriangulationTriggered: parsedReceipt.antiTriangulationAlert,
            confidenceScore: parsedReceipt.confidenceScore,
          },
          recommendation: isSafe
            ? 'Comprobante válido y verificado. Provisión de fondos autorizada.'
            : 'Discrepancia detectada: verificar captura en portal bancario antes de liberar criptoactivos.',
        },
        executedAt: now,
      };
    }

    case 'qualify_direct_lead_and_close': {
      const leadChannel = (args['leadChannel'] || 'WHATSAPP') as
        'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM_DM';
      const estimatedWeeklyVolumeUsdt = Number(args['estimatedWeeklyVolumeUsdt'] || 1000);
      const paymentMethodPreferred = String(args['paymentMethodPreferred'] || 'Pago Móvil');
      const isKycVerified = Boolean(args['isKycVerified']);
      const primaryConcern = (args['primaryConcern'] || 'SPEED') as
        'PRICE' | 'SECURITY' | 'SPEED' | 'PAYMENT_LIMITS';
      const currentParallelRate = Number(args['currentParallelRate'] || 85.0);

      const result = qualifyDirectLeadAndClose({
        leadChannel,
        estimatedWeeklyVolumeUsdt,
        paymentMethodPreferred,
        isKycVerified,
        primaryConcern,
        currentParallelRate,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'generate_social_traffic_funnel': {
      const targetAudience = (args['targetAudience'] || 'RETAIL_SAVERS') as
        'RETAIL_SAVERS' | 'MERCHANT_IMPORTERS' | 'P2P_ARBITRAGEURS';
      const platform = (args['platform'] || 'INSTAGRAM') as 'INSTAGRAM' | 'TIKTOK' | 'TWITTER_X';
      const currentBcvGapPct = Number(args['currentBcvGapPct'] || 20.0);
      const educationalTheme = (args['educationalTheme'] || 'INFLATION_HEDGE') as
        'INFLATION_HEDGE' | 'TRIANGULATION_BASICS' | 'AVOID_BANK_FREEZES';

      const result = generateSocialTrafficFunnel({
        targetAudience,
        platform,
        currentBcvGapPct,
        educationalTheme,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'benchmark_competitor_market_intelligence': {
      const ourCurrentPrice = Number(args['ourCurrentPrice'] || 85.0);
      const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
      const ourMinMarginPct = Number(args['ourMinMarginPct'] || 0.8);
      const competitorOffers = (args['competitorOffers'] || []) as any[];

      const result = benchmarkCompetitorMarketIntelligence({
        ourCurrentPrice,
        targetSide,
        ourMinMarginPct,
        competitorOffers,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'orchestrate_workspace_sync': {
      const entityType = (args['entityType'] || 'ORDER') as
        'ORDER' | 'DISPUTE' | 'BANK_INCIDENT' | 'SOP_VIOLATION';
      const referenceId = String(args['referenceId'] || 'REF-AUTO');
      const urgencyLevel = (args['urgencyLevel'] || 'MEDIUM') as
        'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      const operatorAssigned = String(args['operatorAssigned'] || 'Operador Principal');
      const summaryText = String(args['summaryText'] || 'Evento operativo registrado');
      const metadataPayload = (args['metadataPayload'] || {}) as Record<string, unknown>;

      const result = orchestrateWorkspaceSync({
        entityType,
        referenceId,
        urgencyLevel,
        operatorAssigned,
        summaryText,
        metadataPayload,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'execute_desktop_rpa_reconciliation': {
      const bankName = String(args['bankName'] || 'Banesco');
      const rawBankStatements = (args['rawBankStatements'] || []) as any[];
      const registeredP2pOrders = (args['registeredP2pOrders'] || []) as any[];

      const result = executeDesktopRpaReconciliation({
        bankName,
        rawBankStatements,
        registeredP2pOrders,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'monitor_service_health_and_fallback': {
      const webSocketLatencyMs = Number(args['webSocketLatencyMs'] || 120);
      const bankApiUptimePct = Number(args['bankApiUptimePct'] || 99.5);
      const dbQueryResponseTimeMs = Number(args['dbQueryResponseTimeMs'] || 15);
      const unresolvedErrorsCount = Number(args['unresolvedErrorsCount'] || 0);

      const result = monitorServiceHealthAndFallback({
        webSocketLatencyMs,
        bankApiUptimePct,
        dbQueryResponseTimeMs,
        unresolvedErrorsCount,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'triage_incident_and_escalate': {
      const incidentType = (args['incidentType'] || 'BANK_ACCOUNT_HOLD') as
        'BANK_ACCOUNT_HOLD' | 'THIRD_PARTY_PAYMENT' | 'PARTIAL_PAYMENT_FRAUD' | 'APP_LATENCY_DELAY';
      const amountAtRiskUsdt = Number(args['amountAtRiskUsdt'] || 0);
      const orderId = args['orderId'] ? String(args['orderId']) : undefined;
      const counterpartyAlias = args['counterpartyAlias']
        ? String(args['counterpartyAlias'])
        : undefined;

      const result = triageIncidentAndEscalate({
        incidentType,
        amountAtRiskUsdt,
        orderId,
        counterpartyAlias,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'audit_sop_compliance_enforcement': {
      const orderId = String(args['orderId'] || 'ORD-TEST');
      const accountHolderMatchesDocument = Boolean(args['accountHolderMatchesDocument']);
      const bankBalanceConfirmedInAvailableFunds = Boolean(
        args['bankBalanceConfirmedInAvailableFunds'],
      );
      const responseTimeMinutes = Number(args['responseTimeMinutes'] || 5);
      const fundsReleasedBeforeBankVerification = Boolean(
        args['fundsReleasedBeforeBankVerification'],
      );

      const result = auditSopComplianceEnforcement({
        orderId,
        accountHolderMatchesDocument,
        bankBalanceConfirmedInAvailableFunds,
        responseTimeMinutes,
        fundsReleasedBeforeBankVerification,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'sync_google_sheets_live_ledger': {
      const tradeDate = String(args['tradeDate'] || new Date().toISOString().split('T')[0]);
      const orderId = String(args['orderId'] || 'ORD-SHEET');
      const counterpartyAlias = String(args['counterpartyAlias'] || 'Counterparty');
      const tradeType = (args['tradeType'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
      const cryptoAmountUsdt = Number(args['cryptoAmountUsdt'] || 100);
      const fiatAmountVes = Number(args['fiatAmountVes'] || 8500);
      const exchangeRate = Number(args['exchangeRate'] || 85.0);
      const platformFeeUsdt = Number(args['platformFeeUsdt'] || 0.1);
      const bankTransferFeeVes = Number(args['bankTransferFeeVes'] || 0);

      const result = syncGoogleSheetsLiveLedger({
        tradeDate,
        orderId,
        counterpartyAlias,
        tradeType,
        cryptoAmountUsdt,
        fiatAmountVes,
        exchangeRate,
        platformFeeUsdt,
        bankTransferFeeVes,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'forecast_cash_flow_and_reconciliation': {
      const fiatBankBalancesTotalUsdtEquiv = Number(args['fiatBankBalancesTotalUsdtEquiv'] || 1000);
      const cryptoExchangeBalancesUsdt = Number(args['cryptoExchangeBalancesUsdt'] || 5000);
      const pendingUnsettledOrdersUsdt = Number(args['pendingUnsettledOrdersUsdt'] || 500);
      const dailyProjectedVolumeUsdt = Number(args['dailyProjectedVolumeUsdt'] || 2500);
      const averageOperationalExpensesDailyUsdt = Number(
        args['averageOperationalExpensesDailyUsdt'] || 30,
      );

      const result = forecastCashFlowAndReconciliation({
        fiatBankBalancesTotalUsdtEquiv,
        cryptoExchangeBalancesUsdt,
        pendingUnsettledOrdersUsdt,
        dailyProjectedVolumeUsdt,
        averageOperationalExpensesDailyUsdt,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    default:
      return null;
  }
}
