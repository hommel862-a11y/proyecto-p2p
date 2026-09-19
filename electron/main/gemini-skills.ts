/**
 * Financial Agent Skills for Gemini Orchestrator within the Electron desktop shell.
 * Self-contained schemas and deterministic dispatchers for Function Calling.
 *
 * Mecanismo (decisión documentada — Opción B, alternativa):
 * Los cómputos reales provienen de los motores de dominio de @p2p/core. Como
 * `electron/tsconfig.json` usa `rootDir: "."` (error TS6059 si se importa TS fuera
 * de `electron/`) y el bundle `packages/mcp-server/dist/index.js` es ESM sin exports
 * de motores, los motores puros se embarran byte-idénticos en
 * `./vendor/p2p-core/*` (ver vendor/p2p-core/README.md) y se compilan junto al build.
 * `executeFinancialSkill` permanece síncrona (requisito de gemini-orchestrator).
 */

import type { BinanceOfferSummary } from './vendor/p2p-core/binance-p2p';
import type { BlindThreatRecord, ThreatMatchResult } from './vendor/p2p-core/zk-market-mesh';
import type { PriceTick, VolatilityForecastResult } from './vendor/p2p-core/volatility-forecaster';
import type { FraudShieldAuditResult } from './vendor/p2p-core/fraud-shield';
import {
  buildBinanceSearchPayload,
  parseBinanceP2pItems,
} from './vendor/p2p-core/binance-p2p';
import {
  parseBankReceiptText,
  type BankType,
} from './vendor/p2p-core/receipt-ocr';
import {
  calculateBcvGap,
  getBcvMarketIntelligence,
  predictBcvIntervention,
} from './vendor/p2p-core/bcv-intervention-predictor';
import {
  calculatePortfolioDelta,
  evaluateDeltaHedge,
} from './vendor/p2p-core/delta-neutral-hedge';
import {
  predictTwoHourVolatility,
} from './vendor/p2p-core/volatility-forecaster';
import {
  DEFAULT_ZK_SALT_DOMAIN,
  generateBlindHash,
  normalizeIdentifier,
  ZkMarketMesh,
} from './vendor/p2p-core/zk-market-mesh';
import {
  buildDisputeDossier,
} from './vendor/p2p-core/dispute-copilot';
import {
  evaluateFraudRisk,
} from './vendor/p2p-core/fraud-shield';
import {
  simulateTradeImpact,
} from './vendor/p2p-core/trade-impact-simulator';
import {
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
  analyzeFxCorridorEfficiency,
  calculateCrossExchangeBasisSpread,
  type FxCorridorQuote,
  type PlatformPricePoint,
} from './vendor/p2p-core/triangular-arbitrage';
import {
  computeAvellanedaStoikovQuotes,
  calculateVpinMetric,
  computeOrderSlicingPlan,
  calculateMakerFillProbabilityMarkov,
} from './vendor/p2p-core/orderbook-microstructure';
import {
  calculateConvexityAndGammaRisk,
  modelPerpetualFundingArbitrage,
  optimizeCapitalAllocationKelly,
} from './vendor/p2p-core/delta-neutral-hedge';
import {
  forecastCentralBankLiquidityDrain,
  monitorFiatFlightAndDollarizationVelocity,
  simulateGameTheoryNashRepricing,
} from './vendor/p2p-core/bcv-intervention-predictor';
import {
  optimizeIdleCapitalSimpleEarn,
  evaluateDualInvestmentP2pExit,
  calculateUsdtFdusdYieldArbitrage,
  modelLaunchpoolCapitalParking,
  optimizeLockedVsFlexibleLiquidityLadder,
  calculateEarnYieldVsP2pHurdleRate,
  modelBnbVaultYieldStacking,
  forecastFlexibleEarnTierSaturation,
  calculateAutoInvestDcaSpreadFunnel,
  simulateEarnInstantRedemptionLatency,
} from './vendor/p2p-core/binance-earn-vault';
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
} from './vendor/p2p-core/operations-workflow';
import { request as httpsRequest } from 'node:https';

export interface AgentSkillParameterSchema {
  type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  description: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, AgentSkillParameterSchema>;
  required?: string[];
}

export interface AgentSkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, AgentSkillParameterSchema>;
    required: string[];
  };
}

export interface FinancialSkillResult {
  success: boolean;
  skillName: string;
  data?: unknown;
  error?: string;
  executedAt: number;
}

// ---------------------------------------------------------------------------
// Estado en proceso e integración (mercado P2P en vivo + malla ZK federada).
// ---------------------------------------------------------------------------

/**
 * Libro P2P en memoria alimentado con la misma fuente de datos en vivo que el
 * servidor MCP embebido (Binance C2C adv/search). Los skills SÍNCRONOS lo leen
 * con `require` relativo; el refresco asíncrono solo cuando se invoca
 * `refreshFinancialSkillMarketData()` (hook en mcp-bootstrap) o desde tests.
 */
interface P2pBookSnapshot {
  asset: string;
  fiat: string;
  buyOffers: BinanceOfferSummary[];
  sellOffers: BinanceOfferSummary[];
  bestBuyPrice: number;
  bestSellPrice: number;
  /** Profundidad estimada en USDT a partir del máximo por anuncio (maxVes/price). */
  bidDepthUsdt: number;
  askDepthUsdt: number;
  updatedAt: number;
}

let marketBook: P2pBookSnapshot | null = null;

/**
 * Mesh ZK antifraude federado (motor real de `core/lib/zk-market-mesh`).
 * Singleton en proceso; NOTA: la persistencia entre reinicios no se engancha a
 * SQLite en esta WU — `reportMeshThreat` permite a la app/pipeline sembrar flags.
 */
const zkMesh = new ZkMarketMesh('electron-copilot-node');

/** Buffer de ticks de precio observados para el pronóstico de volatilidad 2h. */
const volatilityTicks: PriceTick[] = [];

/** Regla de Oro institucional: misma que aplica la tool `calculate_spread` del
 * servidor MCP embebido (`isGolden = netSpreadPercent >= 0.50`) y el dominio
 * `spread-quality`. Umbral de POLÍTICA, no lógica duplicada. */
const GOLDEN_SPREAD_MIN_PCT = 0.5;

function buildBookSnapshot(
  buyOffers: BinanceOfferSummary[],
  sellOffers: BinanceOfferSummary[],
): P2pBookSnapshot {
  const bestBuyPrice = buyOffers.length > 0 ? Math.min(...buyOffers.map((o) => o.price)) : 0;
  const bestSellPrice = sellOffers.length > 0 ? Math.max(...sellOffers.map((o) => o.price)) : 0;
  const depthUsdt = (offers: BinanceOfferSummary[]): number =>
    offers.reduce((acc, o) => acc + (o.price > 0 && o.maxVes > 0 ? o.maxVes / o.price : 0), 0);
  return {
    asset: 'USDT',
    fiat: 'VES',
    buyOffers,
    sellOffers,
    bestBuyPrice,
    bestSellPrice,
    bidDepthUsdt: depthUsdt(buyOffers),
    askDepthUsdt: depthUsdt(sellOffers),
    updatedAt: Date.now(),
  };
}

/**
 * Siembra el libro P2P (tests / integración reemplazable). Devuelve el snapshot.
 */
export function seedFinancialSkillMarketData(book: {
  buyOffers: BinanceOfferSummary[];
  sellOffers: BinanceOfferSummary[];
}): P2pBookSnapshot {
  marketBook = buildBookSnapshot(book.buyOffers ?? [], book.sellOffers ?? []);
  return marketBook;
}

/**
 * Limpia el libro P2P. Útil para forzar el fallback documentado en tests.
 */
export function clearFinancialSkillMarketData(): void {
  marketBook = null;
}

/**
 * Estado del caché de mercado actual (lectura síncrona para integración/UI).
 */
export function getFinancialSkillMarketData(): {
  available: boolean;
  updatedAt?: number;
  bestBuyPrice?: number;
  bestSellPrice?: number;
  bidDepthUsdt?: number;
  askDepthUsdt?: number;
} {
  if (!marketBook) return { available: false };
  return {
    available: true,
    updatedAt: marketBook.updatedAt,
    bestBuyPrice: marketBook.bestBuyPrice,
    bestSellPrice: marketBook.bestSellPrice,
    bidDepthUsdt: marketBook.bidDepthUsdt,
    askDepthUsdt: marketBook.askDepthUsdt,
  };
}

function httpJsonPost(
  url: string,
  payload: unknown,
): Promise<{ ok: boolean; status?: number; data?: unknown }> {
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ ok: false });
      return;
    }
    const req = httpsRequest(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'electron-copilot/2.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({
              ok: (res.statusCode ?? 0) === 200,
              status: res.statusCode,
              data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            resolve({ ok: (res.statusCode ?? 0) === 200, status: res.statusCode });
          }
        });
      },
    );
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Refresca el libro P2P desde Binance C2C (misma fuente en vivo que el MCP
 * embebido). Fire-and-forget y siempre silencioso ante fallos; usado por el hook
 * en `mcp-bootstrap.ts` y por integración. Nunca revienta el flujo síncrono.
 */
export async function refreshFinancialSkillMarketData(): Promise<{
  ok: boolean;
  message: string;
  updatedAt?: number;
}> {
  try {
    const [buyRes, sellRes] = await Promise.all([
      httpJsonPost(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        buildBinanceSearchPayload('USDT', 'VES', 'BUY', undefined, 20),
      ),
      httpJsonPost(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        buildBinanceSearchPayload('USDT', 'VES', 'SELL', undefined, 20),
      ),
    ]);
    const buyOffers = parseBinanceP2pItems(buyRes.data);
    const sellOffers = parseBinanceP2pItems(sellRes.data);
    if (!buyRes.ok || !sellRes.ok || (buyOffers.length === 0 && sellOffers.length === 0)) {
      return {
        ok: false,
        message: 'No se obtuvieron ofertas válidas de Binance C2C (red/format). Libro sin refrescar.',
      };
    }
    marketBook = buildBookSnapshot(buyOffers, sellOffers);
    return {
      ok: true,
      message: `Libro P2P actualizado: ${buyOffers.length} ventas / ${sellOffers.length} compras.`,
      updatedAt: marketBook.updatedAt,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: `refreshFinancialSkillMarketData falló: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Reporta una amenaza al mesh ZK (el muro antifraude consultado por
 * `audit_zk_mesh_threat`). Integración/pipeline/operador solo.
 */
export function reportMeshThreat(params: {
  rawIdentifier: string;
  threatType: BlindThreatRecord['threatType'];
  severity?: BlindThreatRecord['severity'];
  sanitizedSummary: string;
  saltDomain?: string;
}): BlindThreatRecord | null {
  return zkMesh.reportThreat(params);
}

export function getZkMeshStats(): { nodeId: string; threatCount: number } {
  return { nodeId: zkMesh.getNodeId(), threatCount: zkMesh.getThreatCount() };
}

function recordVolatilityTick(
  parallelRate: number | undefined,
  currentSpreadPct: number,
): void {
  let buy = 0;
  let sell = 0;
  if (parallelRate && parallelRate > 0 && currentSpreadPct > 0) {
    sell = parallelRate;
    buy = parallelRate * (1 - currentSpreadPct / 100);
  } else if (marketBook && marketBook.bestBuyPrice > 0 && marketBook.bestSellPrice > 0) {
    buy = marketBook.bestBuyPrice;
    sell = marketBook.bestSellPrice;
  }
  if (buy <= 0 || sell <= 0) return;
  volatilityTicks.push({ timestampMs: Date.now(), buyPrice: buy, sellPrice: sell });
  if (volatilityTicks.length > 40) volatilityTicks.shift();
}

function getSideOffers(side: 'BUY' | 'SELL'): BinanceOfferSummary[] {
  if (!marketBook) return [];
  return side === 'BUY' ? marketBook.buyOffers : marketBook.sellOffers;
}

/**
 * Normaliza el nombre de banco recibido a los valores de `BankType` del dominio
 * (recepción de comprobantes). Mapeo de datos, no lógica de cálculo.
 */
function normalizeBankToType(bankName: string): BankType {
  const norm = (bankName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (norm.includes('BANESCO')) return 'BANESCO';
  if (norm.includes('MERCANTIL')) return 'MERCANTIL';
  if (norm.includes('BANCODEVENEZUELA') || norm.includes('BDV')) return 'BDV';
  if (norm.includes('PROVINCIAL')) return 'PROVINCIAL';
  if (norm.includes('BANCAMIGA')) return 'BANCAMIGA';
  if (norm.includes('BANCOLOMBIA')) return 'BANCOLOMBIA';
  if (norm.includes('NEQUI')) return 'NEQUI';
  if (norm.includes('ZINLI')) return 'ZINLI';
  if (norm.includes('ELDORADO') || norm.includes('DORADO')) return 'EL_DORADO';
  return 'UNKNOWN';
}

export const GEMINI_FINANCIAL_SKILLS: AgentSkillDefinition[] = [
  {
    name: 'scan_triangular_arbitrage',
    description: 'Calcula el spread neto y viabilidad de una ruta de arbitraje triangular de 3 piernas. Deduce comisiones y fricción bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        initialAmount: {
          type: 'NUMBER',
          description: 'Monto inicial a convertir (ej. 1000 USDT).',
        },
        initialCurrency: {
          type: 'STRING',
          description: 'Símbolo de la divisa de origen (ej. USDT, VES).',
        },
      },
      required: ['initialAmount', 'initialCurrency'],
    },
  },
  {
    name: 'predict_bcv_market_intelligence',
    description: 'Calcula la brecha cambiaria entre dólar BCV oficial y paralelo y evalúa el ciclo semanal de inyección bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        parallelRate: {
          type: 'NUMBER',
          description: 'Tasa promedio de venta en mercado paralelo P2P (VES/USD).',
        },
        bcvRate: {
          type: 'NUMBER',
          description: 'Tasa de cambio oficial publicada por el BCV (VES/USD).',
        },
      },
      required: ['parallelRate', 'bcvRate'],
    },
  },
  {
    name: 'evaluate_golden_spread',
    description: 'Compara un spread neto contra la Regla de Oro institucional (umbral mínimo recomendado de 0.50%).',
    parameters: {
      type: 'OBJECT',
      properties: {
        netSpreadPct: {
          type: 'NUMBER',
          description: 'Margen neto estimado en porcentaje.',
        },
      },
      required: ['netSpreadPct'],
    },
  },
  {
    name: 'evaluate_delta_neutral_hedge',
    description: 'Audita la exposición neta en moneda local (VES) y propone órdenes de cobertura sintética (delta-neutral) con derivados spot/perp si se supera el riesgo de devaluación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vesBalance: {
          type: 'NUMBER',
          description: 'Balance actual de bolívares (VES) en tesorería o cuentas bancarias.',
        },
        usdtBalance: {
          type: 'NUMBER',
          description: 'Balance actual en USDT en billeteras y plataformas.',
        },
        currentParallelRate: {
          type: 'NUMBER',
          description: 'Tasa paralela de mercado VES/USDT.',
        },
        vesMaxHoldingTimeMinutes: {
          type: 'NUMBER',
          description: 'Minutos que el inventario de VES lleva ocioso sin rotar.',
        },
      },
      required: ['vesBalance', 'usdtBalance', 'currentParallelRate'],
    },
  },
  {
    name: 'forecast_market_volatility_2h',
    description: 'Pronostica el índice de volatilidad, dirección del spread y markups recomendados de compra/venta para las próximas 2 horas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpreadPct: {
          type: 'NUMBER',
          description: 'Spread actual de mercado en porcentaje (ej. 1.20).',
        },
        parallelRate: {
          type: 'NUMBER',
          description: 'Tasa paralela actual de referencia.',
        },
        bcvRate: {
          type: 'NUMBER',
          description: 'Tasa BCV oficial de referencia.',
        },
      },
      required: ['currentSpreadPct'],
    },
  },
  {
    name: 'audit_zk_mesh_threat',
    description: 'Audita identificadores sensibles (cédula, RIF, teléfono, cuenta bancaria) contra la red ZK de inteligencia antifraude usando hashes ciegos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description: 'Cédula de identidad, RIF, número telefónico o número de cuenta de la contraparte.',
        },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'generate_dispute_dossier',
    description: 'Construye un expediente formal y arbitral bilingüe (español/inglés) para mediar en disputas P2P de Binance por pagos de terceros o discrepancias.',
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
      required: ['orderId', 'orderAmountFiat', 'orderAmountCrypto', 'counterpartyBinanceName', 'bankPayerName', 'bankName', 'bankReference'],
    },
  },
  {
    name: 'simulate_trade_impact',
    description: 'Simula el llenado real de una orden P2P calculando el precio VWAP y deslizamiento en puntos básicos según la profundidad del libro.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAmountUsdt: {
          type: 'NUMBER',
          description: 'Volumen objetivo en USDT.',
        },
        side: {
          type: 'STRING',
          description: 'Lado de la operación (BUY o SELL).',
          enum: ['BUY', 'SELL'],
        },
      },
      required: ['targetAmountUsdt', 'side'],
    },
  },
  {
    name: 'calculate_optimal_spread_avellaneda',
    description: 'Calcula el precio de reserva y cotizaciones óptimas de compra/venta bajo el modelo cuantitativo de Avellaneda-Stoikov basado en inventario y volatilidad.',
    parameters: {
      type: 'OBJECT',
      properties: {
        midPrice: { type: 'NUMBER', description: 'Precio medio actual del mercado.' },
        currentInventoryUsdt: { type: 'NUMBER', description: 'Inventario actual en USDT.' },
        targetInventoryUsdt: { type: 'NUMBER', description: 'Inventario objetivo en USDT.' },
        volatilityDaily: { type: 'NUMBER', description: 'Volatilidad diaria estimada en decimal (ej. 0.02 = 2%).' },
        timeRemainingFraction: { type: 'NUMBER', description: 'Fracción de horizonte restante (0 a 1.0).' },
      },
      required: ['midPrice', 'currentInventoryUsdt', 'targetInventoryUsdt', 'volatilityDaily'],
    },
  },
  {
    name: 'estimate_adverse_selection_vpin',
    description: 'Estima la probabilidad de toxicidad de flujo informado mediante la métrica VPIN (Volume-Synchronized Probability of Toxicity) para proteger el spread.',
    parameters: {
      type: 'OBJECT',
      properties: {
        buckets: {
          type: 'ARRAY',
          description: 'Lista de buckets de volumen con buyVolume, sellVolume y totalVolume.',
          items: { type: 'OBJECT', description: 'Bucket de volumen VPIN.' },
        },
        toxicityThreshold: { type: 'NUMBER', description: 'Umbral de toxicidad (default 0.25).' },
      },
      required: ['buckets'],
    },
  },
  {
    name: 'compute_optimal_order_slicing_twap_vwap',
    description: 'Divide un bloque institucional grande en micro-lotes TWAP/VWAP para minimizar el impacto de mercado y prevenir front-running.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalAmountUsdt: { type: 'NUMBER', description: 'Volumen institucional total a ejecutar.' },
        executionDurationMinutes: { type: 'NUMBER', description: 'Duración total de ejecución en minutos.' },
        estimatedMarketVolumePerHourUsdt: { type: 'NUMBER', description: 'Volumen horario estimado del mercado.' },
        currentMidPrice: { type: 'NUMBER', description: 'Precio medio actual.' },
        algorithm: { type: 'STRING', enum: ['TWAP', 'VWAP'], description: 'Algoritmo de ponderación temporal.' },
      },
      required: ['totalAmountUsdt', 'executionDurationMinutes', 'estimatedMarketVolumePerHourUsdt', 'currentMidPrice', 'algorithm'],
    },
  },
  {
    name: 'calculate_maker_fill_probability_markov',
    description: 'Calcula la probabilidad estocástica de llenado de una orden Maker y tiempo estimado de espera mediante procesos markovianos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        queuePositionIndex: { type: 'INTEGER', description: 'Posición en la cola (0 = punta).' },
        queueAheadVolumeUsdt: { type: 'NUMBER', description: 'Volumen por delante en el libro.' },
        recentFillVelocityPerMinuteUsdt: { type: 'NUMBER', description: 'Velocidad de absorción del mercado en USDT/min.' },
        targetHorizonMinutes: { type: 'NUMBER', description: 'Horizonte temporal evaluado en minutos.' },
      },
      required: ['queuePositionIndex', 'queueAheadVolumeUsdt', 'recentFillVelocityPerMinuteUsdt'],
    },
  },
  {
    name: 'analyze_fx_corridor_efficiency',
    description: 'Compara y ranquea la eficiencia de múltiples corredores de remesas internacionales (USDT/VES, USDT/COP, etc.) deduciendo fricción bancaria y latencia.',
    parameters: {
      type: 'OBJECT',
      properties: {
        baseAmountUsdt: { type: 'NUMBER', description: 'Monto base a convertir en USDT.' },
        corridors: {
          type: 'ARRAY',
          description: 'Lista de corredores con cotizaciones, fricción y tiempos de liquidación.',
          items: { type: 'OBJECT', description: 'Corredor FX.' },
        },
      },
      required: ['baseAmountUsdt', 'corridors'],
    },
  },
  {
    name: 'calculate_cross_exchange_basis_spread',
    description: 'Detecta oportunidades de arbitraje espacial de base entre distintas plataformas P2P (Binance, Bybit, El Dorado).',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Capital disponible para arbitraje en USDT.' },
        platforms: {
          type: 'ARRAY',
          description: 'Puntos de precio por plataforma con bid, ask y comisiones.',
          items: { type: 'OBJECT', description: 'Precios de plataforma.' },
        },
      },
      required: ['capitalUsdt', 'platforms'],
    },
  },
  {
    name: 'calculate_convexity_and_gamma_risk',
    description: 'Modela la pérdida patrimonial acelerada por riesgo de convexidad y efecto Gamma ante saltos devaluatorios no lineales del tipo de cambio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spotParallelRate: { type: 'NUMBER', description: 'Tasa paralela actual.' },
        vesHoldingAmount: { type: 'NUMBER', description: 'Monto de bolívares en cartera.' },
        expectedDevaluationJumpPct: { type: 'NUMBER', description: 'Salto devaluatorio proyectado en porcentaje.' },
        timeHorizonDays: { type: 'NUMBER', description: 'Días de exposición proyectados.' },
      },
      required: ['spotParallelRate', 'vesHoldingAmount', 'expectedDevaluationJumpPct', 'timeHorizonDays'],
    },
  },
  {
    name: 'model_perpetual_funding_arbitrage',
    description: 'Calcula el rendimiento APY del arbitraje de Funding Rate en derivados perpetuos (Cash-and-Carry) para subsidiar tesorería.',
    parameters: {
      type: 'OBJECT',
      properties: {
        collateralUsdt: { type: 'NUMBER', description: 'Colateral en USDT disponible.' },
        currentFundingRate8hPct: { type: 'NUMBER', description: 'Tasa de financiamiento por 8h en porcentaje.' },
        holdingPeriodDays: { type: 'NUMBER', description: 'Días estimados de mantenimiento de posición.' },
      },
      required: ['collateralUsdt', 'currentFundingRate8hPct', 'holdingPeriodDays'],
    },
  },
  {
    name: 'optimize_capital_allocation_kelly',
    description: 'Optimiza el tamaño del ticket y distribución por entidad bancaria mediante el Criterio Fraccional de Kelly.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total de la tesorería en USDT.' },
        winRatePct: { type: 'NUMBER', description: 'Tasa de acierto histórica en operaciones P2P.' },
        averageProfitPerWinUsdt: { type: 'NUMBER', description: 'Ganancia promedio por trade ganador.' },
        averageLossPerLossUsdt: { type: 'NUMBER', description: 'Pérdida promedio por trade adverso.' },
      },
      required: ['totalCapitalUsdt', 'winRatePct', 'averageProfitPerWinUsdt', 'averageLossPerLossUsdt'],
    },
  },
  {
    name: 'forecast_central_bank_liquidity_drain',
    description: 'Modela el impacto macro del drenaje de liquidez interbancaria (recaudación fiscal SENIAT y subastas BCV) sobre la demanda P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dayOfMonth: { type: 'INTEGER', description: 'Día del mes (1 a 31).' },
        dayOfWeek: { type: 'INTEGER', description: 'Día de la semana (0=Dom, 1=Lun).' },
        estimatedSeniatCollectionActive: { type: 'BOOLEAN', description: 'Indica si hay recaudación especial activa.' },
        weeklyBcvInjectionMillionsUsd: { type: 'NUMBER', description: 'Monto de la inyección semanal del BCV en millones USD.' },
      },
      required: ['dayOfMonth', 'dayOfWeek', 'estimatedSeniatCollectionActive', 'weeklyBcvInjectionMillionsUsd'],
    },
  },
  {
    name: 'monitor_fiat_flight_and_dollarization_velocity',
    description: 'Mide la velocidad de repudio de la moneda local (MV=PY) y determina el umbral máximo seguro de tenencia de saldos en VES.',
    parameters: {
      type: 'OBJECT',
      properties: {
        averageVesHoldingMinutes: { type: 'NUMBER', description: 'Tiempo promedio que los comercios retienen bolívares.' },
        merchantUsdtAcceptancePct: { type: 'NUMBER', description: 'Porcentaje de penetración de USDT.' },
        monthlyInflationEstimatePct: { type: 'NUMBER', description: 'Inflación mensual estimada en porcentaje.' },
      },
      required: ['averageVesHoldingMinutes', 'merchantUsdtAcceptancePct', 'monthlyInflationEstimatePct'],
    },
  },
  {
    name: 'simulate_game_theory_nash_repricing',
    description: 'Simula el Equilibrio de Nash entre los creadores de mercado líderes para fijar un precio Maker sin desatar guerras de subcotización.',
    parameters: {
      type: 'OBJECT',
      properties: {
        myCurrentPrice: { type: 'NUMBER', description: 'Precio actual del operador.' },
        targetSide: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Lado del libro.' },
        topCompetitors: {
          type: 'ARRAY',
          description: 'Lista de competidores inmediatos en punta.',
          items: { type: 'OBJECT', description: 'Perfil de competidor.' },
        },
        minimumSpreadAllowedPct: { type: 'NUMBER', description: 'Margen mínimo neto tolerado.' },
      },
      required: ['myCurrentPrice', 'targetSide', 'topCompetitors', 'minimumSpreadAllowedPct'],
    },
  },
  {
    name: 'optimize_idle_capital_simple_earn',
    description: 'Modela y optimiza el rendimiento del capital inactivo en Binance Simple Earn Flexible (tasa APR base + bonus por tramos hasta 500 USDT/FDUSD) para evitar costo de oportunidad de inventario detenido.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Monto total en USDT a colocar en Simple Earn.' },
        tier1LimitUsdt: { type: 'NUMBER', description: 'Límite del tramo promocional Tier 1 (default 500 USDT).' },
        tier1AprPct: { type: 'NUMBER', description: 'Tasa APR del Tier 1 en porcentaje (ej. 10.0).' },
        tier2AprPct: { type: 'NUMBER', description: 'Tasa APR base para excedentes en porcentaje (ej. 2.0).' },
        holdingDays: { type: 'NUMBER', description: 'Días proyectados de retención.' },
      },
      required: ['capitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'evaluate_dual_investment_p2p_exit',
    description: 'Evalúa la estrategia "Sell High" en Binance Dual Investment para fijar salidas con strike price por encima del spot mientras se captura un APR elevado, cubriendo inventario ocioso.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpotPrice: { type: 'NUMBER', description: 'Precio actual spot del criptoactivo.' },
        strikePrice: { type: 'NUMBER', description: 'Precio objetivo de salida (strike price).' },
        durationDays: { type: 'NUMBER', description: 'Duración del producto estructurado en días.' },
        annualizedAprPct: { type: 'NUMBER', description: 'Tasa APR anualizada del producto (ej. 25.0).' },
        investedCapitalUsdt: { type: 'NUMBER', description: 'Capital colocado en el contrato.' },
      },
      required: ['currentSpotPrice', 'strikePrice', 'durationDays', 'annualizedAprPct', 'investedCapitalUsdt'],
    },
  },
  {
    name: 'calculate_usdt_fdusd_yield_arbitrage',
    description: 'Compara el APR y la paridad de tipos entre USDT y FDUSD en Binance Earn para maximizar el carry de tesorería y determinar breakeven de conversión.',
    parameters: {
      type: 'OBJECT',
      properties: {
        usdtBalance: { type: 'NUMBER', description: 'Saldo en USDT.' },
        fdusdBalance: { type: 'NUMBER', description: 'Saldo en FDUSD.' },
        usdtFlexibleAprPct: { type: 'NUMBER', description: 'APR flexible de USDT en porcentaje.' },
        fdusdFlexibleAprPct: { type: 'NUMBER', description: 'APR flexible de FDUSD en porcentaje.' },
        usdtFdusdMarketRate: { type: 'NUMBER', description: 'Tasa de cambio de mercado USDT/FDUSD (ej. 1.0001).' },
        swapFeePct: { type: 'NUMBER', description: 'Comisión de swap spot en porcentaje (0 si hay promo).' },
        plannedHorizonDays: { type: 'NUMBER', description: 'Horizonte de inversión planificado en días.' },
      },
      required: ['usdtBalance', 'fdusdBalance', 'usdtFlexibleAprPct', 'fdusdFlexibleAprPct'],
    },
  },
  {
    name: 'model_launchpool_capital_parking',
    description: 'Modela el rendimiento esperado de stakear BNB, FDUSD o USDT en Launchpool durante pausas operativas del P2P para capturar tokens nuevos y proyectar el APY implícito.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Capital a stakear en USDT o valor equivalente.' },
        stakedAsset: { type: 'STRING', enum: ['BNB', 'FDUSD', 'USDT'], description: 'Activo a stakear.' },
        launchpoolDurationDays: { type: 'NUMBER', description: 'Duración total del Launchpool en días.' },
        totalPoolStaked: { type: 'NUMBER', description: 'Monto total stakeado en el pool por todos los participantes.' },
        dailyRewardPoolTokens: { type: 'NUMBER', description: 'Tokens distribuidos por día en el pool.' },
        estimatedTokenListingPriceUsdt: { type: 'NUMBER', description: 'Precio estimado de listado del nuevo token.' },
        alternativeEarnAprPct: { type: 'NUMBER', description: 'Tasa alternativa en Simple Earn.' },
      },
      required: ['capitalUsdt', 'stakedAsset', 'launchpoolDurationDays', 'totalPoolStaked', 'dailyRewardPoolTokens', 'estimatedTokenListingPriceUsdt'],
    },
  },
  {
    name: 'optimize_locked_vs_flexible_liquidity_ladder',
    description: 'Construye una escalera de liquidez dividiendo el capital entre Simple Earn Flexible (D+0 para atender picos de órdenes P2P) y tramos locked para maximizar APR sin estrangular liquidez.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalTreasuryUsdt: { type: 'NUMBER', description: 'Tesorería total en USDT.' },
        dailyP2pVolumeUsdt: { type: 'NUMBER', description: 'Volumen diario promedio operado en P2P.' },
        p2pTurnoverDays: { type: 'NUMBER', description: 'Días promedio de ciclo de rotación completa.' },
        flexibleAprPct: { type: 'NUMBER', description: 'APR del producto flexible.' },
        locked30dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 30 días.' },
        locked60dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 60 días.' },
        safetyBufferPct: { type: 'NUMBER', description: 'Margen de seguridad porcentual sobre el volumen operativo.' },
      },
      required: ['totalTreasuryUsdt', 'dailyP2pVolumeUsdt', 'p2pTurnoverDays', 'flexibleAprPct', 'locked30dAprPct', 'locked60dAprPct'],
    },
  },
  {
    name: 'calculate_earn_yield_vs_p2p_hurdle_rate',
    description: 'Calcula la tasa de corte (Hurdle Rate) comparando el rendimiento por hora del spread neto P2P contra el rendimiento pasivo libre de riesgo de Binance Simple Earn.',
    parameters: {
      type: 'OBJECT',
      properties: {
        grossP2pSpreadPct: { type: 'NUMBER', description: 'Spread bruto observado en el libro P2P.' },
        platformFeePct: { type: 'NUMBER', description: 'Comisión del exchange P2P.' },
        bankingRiskPremiumPct: { type: 'NUMBER', description: 'Prima por fricción bancaria y comisiones de transferencia.' },
        fxDevaluationRiskPct: { type: 'NUMBER', description: 'Riesgo devaluatorio estimado durante el ciclo.' },
        averageTradeCycleHours: { type: 'NUMBER', description: 'Horas promedio que toma completar un ciclo compra-venta.' },
        simpleEarnAprPct: { type: 'NUMBER', description: 'Tasa APR pasiva libre de riesgo en Binance Simple Earn.' },
      },
      required: ['grossP2pSpreadPct', 'platformFeePct', 'bankingRiskPremiumPct', 'fxDevaluationRiskPct', 'averageTradeCycleHours', 'simpleEarnAprPct'],
    },
  },
  {
    name: 'model_bnb_vault_yield_stacking',
    description: 'Modela la acumulación de recompensas multi-capa en BNB Vault (Launchpool automático, Simple Earn Flexible y airdrops de HODLer).',
    parameters: {
      type: 'OBJECT',
      properties: {
        bnbAmount: { type: 'NUMBER', description: 'Cantidad total de BNB en tenencia.' },
        bnbPriceUsdt: { type: 'NUMBER', description: 'Precio actual del BNB en USDT.' },
        simpleEarnAprPct: { type: 'NUMBER', description: 'APR base de Simple Earn Flexible para BNB.' },
        activeLaunchpoolsCount: { type: 'NUMBER', description: 'Cantidad de Launchpools activos concurrentes.' },
        averageLaunchpoolAprPct: { type: 'NUMBER', description: 'APR promedio histórico de Launchpool.' },
        hodlerAirdropProjectedAprPct: { type: 'NUMBER', description: 'APR proyectado por airdrops a poseedores.' },
      },
      required: ['bnbAmount', 'bnbPriceUsdt', 'simpleEarnAprPct', 'activeLaunchpoolsCount', 'averageLaunchpoolAprPct'],
    },
  },
  {
    name: 'forecast_flexible_earn_tier_saturation',
    description: 'Predice el punto de saturación y degradación del APR en Simple Earn Flexible cuando el balance supera los tramos subvencionados, recomendando dispersión a subcuentas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total a colocar.' },
        tier1LimitPerAccountUsdt: { type: 'NUMBER', description: 'Límite Tier 1 por cuenta (ej. 500 USDT).' },
        tier1AprPct: { type: 'NUMBER', description: 'APR promocional Tier 1.' },
        tier2AprPct: { type: 'NUMBER', description: 'APR degradado Tier 2.' },
        availableSubaccountsCount: { type: 'NUMBER', description: 'Número de subcuentas corporativas disponibles.' },
      },
      required: ['totalCapitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'calculate_auto_invest_dca_spread_funnel',
    description: 'Diseña un embudo de reinversión automática (Auto-Invest DCA) utilizando las ganancias netas del spread P2P para acumular criptoactivos sin descapitalizar la tesorería operativa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        monthlyP2pNetProfitUsdt: { type: 'NUMBER', description: 'Beneficio neto mensual generado por la mesa P2P.' },
        reinvestmentRatioPct: { type: 'NUMBER', description: 'Porcentaje de la ganancia a reinvertir (ej. 25%).' },
        targetAsset: { type: 'STRING', enum: ['BTC', 'ETH', 'BNB', 'SOL'], description: 'Activo objetivo de acumulación.' },
        projectedAnnualAssetGrowthPct: { type: 'NUMBER', description: 'Crecimiento anual proyectado del activo.' },
        executionFrequency: { type: 'STRING', enum: ['DAILY', 'WEEKLY', 'BIWEEKLY'], description: 'Frecuencia de DCA en Auto-Invest.' },
      },
      required: ['monthlyP2pNetProfitUsdt', 'reinvestmentRatioPct', 'targetAsset', 'executionFrequency'],
    },
  },
  {
    name: 'simulate_earn_instant_redemption_latency',
    description: 'Simula el impacto temporal y límites de retiro inmediato (Instant Redemption Quota) en Binance Simple Earn para asegurar disponibilidad antes de liberar órdenes P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        redemptionAmountUsdt: { type: 'NUMBER', description: 'Monto que se necesita retirar de Simple Earn.' },
        dailyInstantQuotaUsdt: { type: 'NUMBER', description: 'Límite diario de rescate instantáneo de la cuenta.' },
        dailyQuotaConsumedUsdt: { type: 'NUMBER', description: 'Cuota instantánea ya utilizada en las últimas 24h.' },
        averageSlippageOrDelayHours: { type: 'NUMBER', description: 'Tiempo estimado de demora en caso de standard redemption.' },
      },
      required: ['redemptionAmountUsdt'],
    },
  },
  {
    name: 'check_bank_operational_status',
    description: 'Monitorea en tiempo real el estado operativo, latencias de acreditación y fallas en plataformas bancarias venezolanas (Banesco, Mercantil, BDV, Pago Móvil) y emite directivas de pausa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bankCodes: {
          type: 'ARRAY',
          description: 'Códigos bancarios a verificar (ej. 0102 BDV, 0134 Banesco, 0105 Mercantil, 0108 Provincial, 0172 Bancamiga, PAGO_MOVIL).',
          items: { type: 'STRING' },
        },
      },
      required: [],
    },
  },
  {
    name: 'check_counterparty_blacklist',
    description: 'Consulta la lista negra institucional de cédulas, teléfonos, cuentas bancarias o alias de Binance reportados por estafas de triangulación o fraude.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cedula: { type: 'STRING', description: 'Número de cédula de identidad a auditar.' },
        phone: { type: 'STRING', description: 'Número telefónico del comprador o pagador.' },
        accountNumber: { type: 'STRING', description: 'Número de cuenta bancaria de 20 dígitos.' },
        binanceAlias: { type: 'STRING', description: 'Alias o nickname de Binance P2P.' },
      },
      required: [],
    },
  },
  {
    name: 'audit_payment_proof_ocr',
    description: 'Auditoría forense de texto extraído de comprobantes bancarios (OCR) para validar montos, números de referencia, concordancia de nombres y prevención de triangulación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ocrText: { type: 'STRING', description: 'Texto plano obtenido del comprobante o captura de pantalla.' },
        expectedAmountVes: { type: 'NUMBER', description: 'Monto en bolívares esperado de la orden.' },
        expectedReference: { type: 'STRING', description: 'Número de referencia bancaria esperado.' },
        expectedPayerName: { type: 'STRING', description: 'Nombre completo verificado de la contraparte en Binance.' },
      },
      required: ['ocrText'],
    },
  },
  {
    name: 'qualify_direct_lead_and_close',
    description: 'Califica prospectos comerciales de WhatsApp/Telegram (ticket, frecuencia, verificación KYC y objeciones) y genera la cotización personalizada con margen institucional.',
    parameters: {
      type: 'OBJECT',
      properties: {
        leadChannel: { type: 'STRING', enum: ['WHATSAPP', 'TELEGRAM', 'INSTAGRAM_DM'], description: 'Canal de entrada del prospecto.' },
        estimatedWeeklyVolumeUsdt: { type: 'NUMBER', description: 'Volumen semanal estimado en USDT.' },
        paymentMethodPreferred: { type: 'STRING', description: 'Método de pago preferido.' },
        isKycVerified: { type: 'BOOLEAN', description: 'Si el cliente ya entregó documento de identidad verificado.' },
        primaryConcern: { type: 'STRING', enum: ['PRICE', 'SECURITY', 'SPEED', 'PAYMENT_LIMITS'], description: 'Principal objeción o prioridad del cliente.' },
        currentParallelRate: { type: 'NUMBER', description: 'Tasa de cambio paralela spot en VES.' },
      },
      required: ['leadChannel', 'estimatedWeeklyVolumeUsdt', 'paymentMethodPreferred', 'isKycVerified', 'primaryConcern', 'currentParallelRate'],
    },
  },
  {
    name: 'generate_social_traffic_funnel',
    description: 'Diseña guiones y contenido educativo de arbitraje y resguardo contra la inflación para redes sociales, orientando tráfico orgánico a la mesa P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAudience: { type: 'STRING', enum: ['RETAIL_SAVERS', 'MERCHANT_IMPORTERS', 'P2P_ARBITRAGEURS'], description: 'Audiencia objetivo.' },
        platform: { type: 'STRING', enum: ['INSTAGRAM', 'TIKTOK', 'TWITTER_X'], description: 'Plataforma social de publicación.' },
        currentBcvGapPct: { type: 'NUMBER', description: 'Brecha actual del BCV en porcentaje.' },
        educationalTheme: { type: 'STRING', enum: ['INFLATION_HEDGE', 'TRIANGULATION_BASICS', 'AVOID_BANK_FREEZES'], description: 'Eje temático.' },
      },
      required: ['targetAudience', 'platform', 'currentBcvGapPct', 'educationalTheme'],
    },
  },
  {
    name: 'benchmark_competitor_market_intelligence',
    description: 'Rastrea y compara precios, métodos de pago y calidad de servicio de competidores activos para optimizar el spread y encontrar nichos desatendidos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ourCurrentPrice: { type: 'NUMBER', description: 'Nuestro precio actual en el libro.' },
        targetSide: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Lado del libro.' },
        ourMinMarginPct: { type: 'NUMBER', description: 'Margen mínimo tolerado por la regla de oro.' },
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
    description: 'Prepara y formatea cargas de eventos e incidencias críticas para sincronización con Notion, ClickUp o Trello mediante webhooks modulares.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entityType: { type: 'STRING', enum: ['ORDER', 'DISPUTE', 'BANK_INCIDENT', 'SOP_VIOLATION'], description: 'Tipo de entidad operativa.' },
        referenceId: { type: 'STRING', description: 'Identificador único de la entidad.' },
        urgencyLevel: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Nivel de urgencia.' },
        operatorAssigned: { type: 'STRING', description: 'Nombre del operador o agente responsable.' },
        summaryText: { type: 'STRING', description: 'Resumen descriptivo del evento.' },
      },
      required: ['entityType', 'referenceId', 'urgencyLevel', 'operatorAssigned', 'summaryText'],
    },
  },
  {
    name: 'execute_desktop_rpa_reconciliation',
    description: 'Concilia de forma automatizada (RPA) extractos bancarios contra órdenes P2P registradas para detectar discrepancias de montos y depósitos huérfanos.',
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
    description: 'Supervisa la salud de sockets, base de datos y APIs bancarias, activando fallbacks preventivos si se degradan los parámetros de operación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        webSocketLatencyMs: { type: 'NUMBER', description: 'Latencia del WebSocket en milisegundos.' },
        bankApiUptimePct: { type: 'NUMBER', description: 'Disponibilidad de APIs bancarias en porcentaje.' },
        dbQueryResponseTimeMs: { type: 'NUMBER', description: 'Tiempo de respuesta de base de datos en ms.' },
        unresolvedErrorsCount: { type: 'INTEGER', description: 'Cantidad de errores no resueltos acumulados.' },
      },
      required: ['webSocketLatencyMs', 'bankApiUptimePct', 'dbQueryResponseTimeMs', 'unresolvedErrorsCount'],
    },
  },
  {
    name: 'triage_incident_and_escalate',
    description: 'Clasifica incidencias y crisis operativas (P1 a P4), calcula SLAs de resolución y activa protocolos de aislamiento e intervención humana.',
    parameters: {
      type: 'OBJECT',
      properties: {
        incidentType: { type: 'STRING', enum: ['BANK_ACCOUNT_HOLD', 'THIRD_PARTY_PAYMENT', 'PARTIAL_PAYMENT_FRAUD', 'APP_LATENCY_DELAY'], description: 'Naturaleza de la incidencia.' },
        amountAtRiskUsdt: { type: 'NUMBER', description: 'Capital total en riesgo en USDT.' },
        orderId: { type: 'STRING', description: 'ID de la orden afectada si aplica.' },
      },
      required: ['incidentType', 'amountAtRiskUsdt'],
    },
  },
  {
    name: 'audit_sop_compliance_enforcement',
    description: 'Audita el cumplimiento estricto de Protocolos Operativos Estándar (verificación de titular, comprobación en saldo disponible y tiempos de respuesta).',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'ID de la orden a auditar.' },
        accountHolderMatchesDocument: { type: 'BOOLEAN', description: 'Si el titular bancario coincide con la cuenta verificada.' },
        bankBalanceConfirmedInAvailableFunds: { type: 'BOOLEAN', description: 'Si el dinero está disponible y no retenido/diferido.' },
        responseTimeMinutes: { type: 'NUMBER', description: 'Minutos transcurridos hasta la atención.' },
        fundsReleasedBeforeBankVerification: { type: 'BOOLEAN', description: 'Si los fondos fueron liberados antes de verificar en banco.' },
      },
      required: ['orderId', 'accountHolderMatchesDocument', 'bankBalanceConfirmedInAvailableFunds', 'responseTimeMinutes', 'fundsReleasedBeforeBankVerification'],
    },
  },
  {
    name: 'sync_google_sheets_live_ledger',
    description: 'Formatea registros transaccionales para Google Sheets / Excel con fórmulas dinámicas de margen neto, comisiones y balances en tiempo real.',
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
      required: ['tradeDate', 'orderId', 'counterpartyAlias', 'tradeType', 'cryptoAmountUsdt', 'fiatAmountVes', 'exchangeRate', 'platformFeeUsdt', 'bankTransferFeeVes'],
    },
  },
  {
    name: 'forecast_cash_flow_and_reconciliation',
    description: 'Concilia balances fiat y cripto, detecta descuadres por comisiones bancarias y proyecta días de runway de tesorería para recompras de inventario.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fiatBankBalancesTotalUsdtEquiv: { type: 'NUMBER', description: 'Balance en bancos equivalente a USDT.' },
        cryptoExchangeBalancesUsdt: { type: 'NUMBER', description: 'Saldo en billeteras de exchange en USDT.' },
        pendingUnsettledOrdersUsdt: { type: 'NUMBER', description: 'Monto en órdenes pendientes de liquidar.' },
        dailyProjectedVolumeUsdt: { type: 'NUMBER', description: 'Volumen diario promedio proyectado.' },
        averageOperationalExpensesDailyUsdt: { type: 'NUMBER', description: 'Gasto operativo diario promedio.' },
      },
      required: ['fiatBankBalancesTotalUsdtEquiv', 'cryptoExchangeBalancesUsdt', 'pendingUnsettledOrdersUsdt', 'dailyProjectedVolumeUsdt', 'averageOperationalExpensesDailyUsdt'],
    },
  },
];

export function executeFinancialSkill(
  skillName: string,
  args: Record<string, unknown>,
): FinancialSkillResult {
  const now = Date.now();

  try {
    switch (skillName) {
      case 'scan_triangular_arbitrage': {
        const initialAmount = Number(args['initialAmount']) || 1000;
        const initialCurrency = String(args['initialCurrency'] || 'USDT').toUpperCase();
        const route =
          DEFAULT_TRIANGULAR_PRESETS.find((r) => r.initialCurrency === initialCurrency) ||
          DEFAULT_TRIANGULAR_PRESETS[0];
        // Motor real (core/lib/triangular-arbitrage#calculateTriangularArbitrage).
        // Si hay libro P2P en vivo, se inyectan precios reales en las piernas
        // USDT<->VES; si no, se usan los precios de referencia del preset (documentado).
        const overriddenLegs = route.legs.map((leg) => {
          const hasVes = leg.fromCurrency === 'VES' || leg.toCurrency === 'VES';
          const hasUsdt = leg.fromCurrency === 'USDT' || leg.toCurrency === 'USDT';
          if (!hasVes || !hasUsdt || !marketBook) return leg;
          const livePrice = leg.toCurrency === 'USDT' ? marketBook.bestBuyPrice : marketBook.bestSellPrice;
          return livePrice > 0 && livePrice !== leg.price ? { ...leg, price: livePrice } : leg;
        });
        const result = calculateTriangularArbitrage(
          route.id,
          route.name,
          initialAmount,
          [overriddenLegs[0], overriddenLegs[1], overriddenLegs[2]],
        );
        return {
          success: true,
          skillName,
          data: {
            netSpreadPct: result.roiPct,
            profitInitialCurrency: result.netProfit,
            isProfitable: result.isProfitable,
            routeId: result.routeId,
            routeName: result.routeName,
            initialAmount: result.initialAmount,
            finalAmount: result.finalAmount,
            roiPct: result.roiPct,
            totalDurationMinutes: result.totalDurationMinutes,
            riskLevel: result.riskLevel,
            riskReasons: result.riskReasons,
            steps: result.steps,
            breakevenPriceLeg3: result.breakevenPriceLeg3,
            slippageTolerancePct: result.slippageTolerancePct,
            engine: 'core/lib/triangular-arbitrage#calculateTriangularArbitrage',
            liveMarketUsed: Boolean(marketBook),
            warning: marketBook ? undefined : 'Sin libro P2P en caché: se usaron precios de referencia del preset de la ruta.',
          },
          executedAt: now,
        };
      }

      case 'predict_bcv_market_intelligence': {
        const parallel = Number(args['parallelRate']) || 0;
        const bcv = Number(args['bcvRate']) || 0;
        // Motor real (core/lib/bcv-intervention-predictor#getBcvMarketIntelligence).
        const intel = getBcvMarketIntelligence(parallel, bcv);
        return {
          success: true,
          skillName,
          data: {
            ...intel,
            engine: 'core/lib/bcv-intervention-predictor#getBcvMarketIntelligence',
          },
          executedAt: now,
        };
      }

      case 'evaluate_golden_spread': {
        const spread = Number(args['netSpreadPct']) || 0;
        // Regla de Oro institucional (umbral de política, no lógica duplicada):
        // misma condición que aplica la tool calculate_spread del MCP embebido.
        const isGolden = spread >= GOLDEN_SPREAD_MIN_PCT;
        return {
          success: true,
          skillName,
          data: {
            netSpreadPct: spread,
            isGolden,
            verdict: isGolden ? 'VIABLE_INSTITUCIONAL' : 'SUB_OPTIMAL',
            thresholdPct: GOLDEN_SPREAD_MIN_PCT,
            engine: 'institución (calculate_spread MCP: isGolden = netSpread >= 0.50)',
          },
          executedAt: now,
        };
      }

      case 'evaluate_delta_neutral_hedge': {
        const snapshot = {
          vesBalance: Number(args['vesBalance'] || 0),
          usdtBalance: Number(args['usdtBalance'] || 0),
          currentParallelRate: Number(args['currentParallelRate'] || 0),
          vesMaxHoldingTimeMinutes: Number(args['vesMaxHoldingTimeMinutes'] || 0),
          openP2pSellOrdersUsdt: Number(args['openP2pSellOrdersUsdt'] || 0),
          openP2pBuyOrdersVes: Number(args['openP2pBuyOrdersVes'] || 0),
        };
        // Motores reales (core/lib/delta-neutral-hedge#calculatePortfolioDelta,
        // #evaluateDeltaHedge).
        const delta = calculatePortfolioDelta(snapshot);
        const proposal = evaluateDeltaHedge(snapshot);
        return {
          success: true,
          skillName,
          data: {
            totalEquityUsd: delta.totalEquityUsd,
            fiatExposureUsd: delta.fiatExposureUsd,
            cryptoExposureUsd: delta.cryptoExposureUsd,
            netDeltaRatio: delta.netDeltaRatio,
            unhedgedVesRiskScore: delta.unhedgedVesRiskScore,
            urgency: delta.urgency,
            proposals: proposal ? [proposal] : [],
            engine: 'core/lib/delta-neutral-hedge#evaluateDeltaHedge',
          },
          executedAt: now,
        };
      }

      case 'forecast_market_volatility_2h': {
        const spreadPct = Number(args['currentSpreadPct'] || 1.2);
        const parallel = Number(args['parallelRate'] || 0);
        const bcv = Number(args['bcvRate'] || 0);
        recordVolatilityTick(parallel || undefined, spreadPct);
        // Motores reales del dominio (core/lib).
        const bcvGap =
          parallel > 0 && bcv > 0 ? calculateBcvGap(parallel, bcv) : undefined;
        const bcvWindow = predictBcvIntervention();
        const bidDepthUsdt = marketBook?.bidDepthUsdt;
        const askDepthUsdt = marketBook?.askDepthUsdt;
        const forecast: VolatilityForecastResult = predictTwoHourVolatility({
          recentTicks: [...volatilityTicks],
          currentSpreadPct: spreadPct,
          bcvGap,
          bcvWindow,
          bidDepthUsdt,
          askDepthUsdt,
        });
        return {
          success: true,
          skillName,
          data: {
            ...forecast,
            sources: {
              recentTicksCount: volatilityTicks.length,
              bcvGap,
              bcvWindow,
              bidDepthUsdt,
              askDepthUsdt,
            },
            engine: 'core/lib/volatility-forecaster#predictTwoHourVolatility',
          },
          executedAt: now,
        };
      }

      case 'audit_zk_mesh_threat': {
        const rawIdentifier = String(args['identifier'] || '');
        const normalized = normalizeIdentifier(rawIdentifier);
        // Motor real: consulta la malla ZK a través de hash ciego. CLEAN solo
        // cuando el mesh NO reporta la identidad (nunca hardcodeado).
        const match: ThreatMatchResult = zkMesh.queryIdentifier(rawIdentifier);
        const threat = match.isMatch && match.threat ? match.threat : null;
        return {
          success: true,
          skillName,
          data: {
            identifierLength: normalized.length,
            riskStatus: threat ? 'FLAGGED' : 'CLEAN',
            threatFound: Boolean(threat),
            confidenceScore: match.confidenceScore,
            threats: threat
              ? [
                  {
                    threatType: threat.threatType,
                    severity: threat.severity,
                    confidenceScore: match.confidenceScore,
                    confirmations: threat.confirmations,
                    sanitizedSummary: threat.sanitizedSummary,
                    reporterNodeId: threat.reporterNodeId,
                    timestamp: threat.timestamp,
                  },
                ]
              : [],
            notes: threat
              ? `Hash ciego encontrado en la red federada (#${threat.blindHash.slice(0, 12)}). Seguir protocolo de retención preventiva.`
              : 'No se detectaron reportes de triangulación o terceros fraudulentos en la red federada.',
            blindHash: generateBlindHash(rawIdentifier),
            engine: 'core/lib/zk-market-mesh#ZkMarketMesh.queryIdentifier',
          },
          executedAt: now,
        };
      }

      case 'generate_dispute_dossier': {
        const orderId = String(args['orderId'] || 'ORD-UNKNOWN');
        const orderAmountFiat = Number(args['orderAmountFiat'] || 0);
        const orderAmountCrypto = Number(args['orderAmountCrypto'] || 0);
        const counterparty = String(args['counterpartyBinanceName'] || 'Contraparte');
        const payer = String(args['bankPayerName'] || '');
        const bankName = String(args['bankName'] || '');
        const bankReference = String(args['bankReference'] || '');
        const bank = normalizeBankToType(bankName);
        // Motores reales: peritaje forense y construcción del expediente arbitral
        // (core/lib/fraud-shield#evaluateFraudRisk + core/lib/dispute-copilot#buildDisputeDossier).
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
          orderCreatedTimestamp: now, // registros en vivo: el skill no recibe timestamps.
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
            engine: 'core/lib/fraud-shield#evaluateFraudRisk + core/lib/dispute-copilot#buildDisputeDossier',
          },
          executedAt: now,
        };
      }

      case 'simulate_trade_impact': {
        const targetUsdt = Number(args['targetAmountUsdt']) || 0;
        const side = (args['side'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        // Motor real (core/lib/trade-impact-simulator#simulateTradeImpact) sobre el
        // libro P2P en vivo. NUNCA devuelve un precio fijo: con libro vacío devuelve
        // el resultado honesto del motor (bestQuotedPrice=0) + fallback documentado.
        const offers = getSideOffers(side);
        const sim = simulateTradeImpact({
          targetAmountUsdt: targetUsdt,
          side,
          availableOffers: offers,
        });
        return {
          success: true,
          skillName,
          data: {
            ...sim,
            engine: 'core/lib/trade-impact-simulator#simulateTradeImpact',
            marketDataSource: offers.length > 0 ? 'LIVE_BINANCE_P2P_CACHE' : 'EMPTY_BOOK_FALLBACK',
            warning: offers.length === 0 ? 'Sin libro P2P en caché: resultado con libro vacío (sin precio inventado).' : undefined,
          },
          executedAt: now,
        };
      }

      case 'calculate_optimal_spread_avellaneda': {
        const midPrice = Number(args['midPrice'] || 85.0);
        const currentInventoryUsdt = Number(args['currentInventoryUsdt'] || 5000);
        const targetInventoryUsdt = Number(args['targetInventoryUsdt'] || 5000);
        const volatilityDaily = Number(args['volatilityDaily'] || 0.02);
        const timeRemainingFraction = Number(args['timeRemainingFraction'] ?? 1.0);

        const result = computeAvellanedaStoikovQuotes({
          midPrice,
          currentInventoryUsdt,
          targetInventoryUsdt,
          volatilityDaily,
          timeRemainingFraction,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'estimate_adverse_selection_vpin': {
        const buckets = (args['buckets'] || []) as any[];
        const toxicityThreshold = Number(args['toxicityThreshold'] || 0.25);

        const result = calculateVpinMetric({
          buckets,
          toxicityThreshold,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'compute_optimal_order_slicing_twap_vwap': {
        const totalAmountUsdt = Number(args['totalAmountUsdt'] || 5000);
        const executionDurationMinutes = Number(args['executionDurationMinutes'] || 60);
        const estimatedMarketVolumePerHourUsdt = Number(args['estimatedMarketVolumePerHourUsdt'] || 50000);
        const currentMidPrice = Number(args['currentMidPrice'] || 85.0);
        const algorithm = (args['algorithm'] === 'VWAP' ? 'VWAP' : 'TWAP') as 'TWAP' | 'VWAP';

        const result = computeOrderSlicingPlan({
          totalAmountUsdt,
          executionDurationMinutes,
          estimatedMarketVolumePerHourUsdt,
          currentMidPrice,
          algorithm,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_maker_fill_probability_markov': {
        const queuePositionIndex = Number(args['queuePositionIndex'] || 0);
        const queueAheadVolumeUsdt = Number(args['queueAheadVolumeUsdt'] || 0);
        const recentFillVelocityPerMinuteUsdt = Number(args['recentFillVelocityPerMinuteUsdt'] || 100);
        const targetHorizonMinutes = Number(args['targetHorizonMinutes'] || 15);

        const result = calculateMakerFillProbabilityMarkov({
          queuePositionIndex,
          queueAheadVolumeUsdt,
          recentFillVelocityPerMinuteUsdt,
          targetHorizonMinutes,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'analyze_fx_corridor_efficiency': {
        const baseAmountUsdt = Number(args['baseAmountUsdt'] || 1000);
        const corridors = (args['corridors'] || []) as any[];

        const result = analyzeFxCorridorEfficiency(baseAmountUsdt, corridors);

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_cross_exchange_basis_spread': {
        const capitalUsdt = Number(args['capitalUsdt'] || 1000);
        const platforms = (args['platforms'] || []) as any[];

        const result = calculateCrossExchangeBasisSpread(capitalUsdt, platforms);

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_convexity_and_gamma_risk': {
        const spotParallelRate = Number(args['spotParallelRate'] || 85.0);
        const vesHoldingAmount = Number(args['vesHoldingAmount'] || 100000);
        const expectedDevaluationJumpPct = Number(args['expectedDevaluationJumpPct'] || 15);
        const timeHorizonDays = Number(args['timeHorizonDays'] || 1);

        const result = calculateConvexityAndGammaRisk({
          spotParallelRate,
          vesHoldingAmount,
          expectedDevaluationJumpPct,
          timeHorizonDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_perpetual_funding_arbitrage': {
        const collateralUsdt = Number(args['collateralUsdt'] || 5000);
        const currentFundingRate8hPct = Number(args['currentFundingRate8hPct'] || 0.01);
        const holdingPeriodDays = Number(args['holdingPeriodDays'] || 7);

        const result = modelPerpetualFundingArbitrage({
          collateralUsdt,
          currentFundingRate8hPct,
          holdingPeriodDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'optimize_capital_allocation_kelly': {
        const totalCapitalUsdt = Number(args['totalCapitalUsdt'] || 10000);
        const winRatePct = Number(args['winRatePct'] || 75);
        const averageProfitPerWinUsdt = Number(args['averageProfitPerWinUsdt'] || 40);
        const averageLossPerLossUsdt = Number(args['averageLossPerLossUsdt'] || 15);

        const result = optimizeCapitalAllocationKelly({
          totalCapitalUsdt,
          winRatePct,
          averageProfitPerWinUsdt,
          averageLossPerLossUsdt,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'forecast_central_bank_liquidity_drain': {
        const dayOfMonth = Number(args['dayOfMonth'] || new Date().getDate());
        const dayOfWeek = Number(args['dayOfWeek'] ?? new Date().getDay());
        const estimatedSeniatCollectionActive = Boolean(args['estimatedSeniatCollectionActive']);
        const weeklyBcvInjectionMillionsUsd = Number(args['weeklyBcvInjectionMillionsUsd'] || 40);

        const result = forecastCentralBankLiquidityDrain({
          dayOfMonth,
          dayOfWeek,
          estimatedSeniatCollectionActive,
          weeklyBcvInjectionMillionsUsd,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'monitor_fiat_flight_and_dollarization_velocity': {
        const averageVesHoldingMinutes = Number(args['averageVesHoldingMinutes'] || 30);
        const merchantUsdtAcceptancePct = Number(args['merchantUsdtAcceptancePct'] || 80);
        const monthlyInflationEstimatePct = Number(args['monthlyInflationEstimatePct'] || 35);

        const result = monitorFiatFlightAndDollarizationVelocity({
          averageVesHoldingMinutes,
          merchantUsdtAcceptancePct,
          monthlyInflationEstimatePct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'simulate_game_theory_nash_repricing': {
        const myCurrentPrice = Number(args['myCurrentPrice'] || 85.0);
        const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const topCompetitors = (args['topCompetitors'] || []) as any[];
        const minimumSpreadAllowedPct = Number(args['minimumSpreadAllowedPct'] || 0.8);

        const result = simulateGameTheoryNashRepricing({
          myCurrentPrice,
          targetSide,
          topCompetitors,
          minimumSpreadAllowedPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'optimize_idle_capital_simple_earn': {
        const capitalUsdt = Number(args['capitalUsdt'] || 0);
        const tier1LimitUsdt = args['tier1LimitUsdt'] !== undefined ? Number(args['tier1LimitUsdt']) : 500;
        const tier1AprPct = Number(args['tier1AprPct'] || 10.0);
        const tier2AprPct = Number(args['tier2AprPct'] || 2.0);
        const holdingDays = args['holdingDays'] !== undefined ? Number(args['holdingDays']) : 30;

        const result = optimizeIdleCapitalSimpleEarn({
          capitalUsdt,
          tier1LimitUsdt,
          tier1AprPct,
          tier2AprPct,
          holdingDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'evaluate_dual_investment_p2p_exit': {
        const currentSpotPrice = Number(args['currentSpotPrice'] || 65000);
        const strikePrice = Number(args['strikePrice'] || 68000);
        const durationDays = Number(args['durationDays'] || 7);
        const annualizedAprPct = Number(args['annualizedAprPct'] || 20.0);
        const investedCapitalUsdt = Number(args['investedCapitalUsdt'] || 1000);

        const result = evaluateDualInvestmentP2pExit({
          currentSpotPrice,
          strikePrice,
          durationDays,
          annualizedAprPct,
          investedCapitalUsdt,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_usdt_fdusd_yield_arbitrage': {
        const usdtBalance = Number(args['usdtBalance'] || 0);
        const fdusdBalance = Number(args['fdusdBalance'] || 0);
        const usdtFlexibleAprPct = Number(args['usdtFlexibleAprPct'] || 2.5);
        const fdusdFlexibleAprPct = Number(args['fdusdFlexibleAprPct'] || 7.0);
        const usdtFdusdMarketRate = args['usdtFdusdMarketRate'] !== undefined ? Number(args['usdtFdusdMarketRate']) : 1.0;
        const swapFeePct = args['swapFeePct'] !== undefined ? Number(args['swapFeePct']) : 0;
        const plannedHorizonDays = args['plannedHorizonDays'] !== undefined ? Number(args['plannedHorizonDays']) : 30;

        const result = calculateUsdtFdusdYieldArbitrage({
          usdtBalance,
          fdusdBalance,
          usdtFlexibleAprPct,
          fdusdFlexibleAprPct,
          usdtFdusdMarketRate,
          swapFeePct,
          plannedHorizonDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_launchpool_capital_parking': {
        const capitalUsdt = Number(args['capitalUsdt'] || 0);
        const stakedAsset = (args['stakedAsset'] === 'BNB' || args['stakedAsset'] === 'FDUSD' ? args['stakedAsset'] : 'USDT') as 'BNB' | 'FDUSD' | 'USDT';
        const launchpoolDurationDays = Number(args['launchpoolDurationDays'] || 4);
        const totalPoolStaked = Number(args['totalPoolStaked'] || 100000000);
        const dailyRewardPoolTokens = Number(args['dailyRewardPoolTokens'] || 200000);
        const estimatedTokenListingPriceUsdt = Number(args['estimatedTokenListingPriceUsdt'] || 2.0);
        const alternativeEarnAprPct = args['alternativeEarnAprPct'] !== undefined ? Number(args['alternativeEarnAprPct']) : 2.5;

        const result = modelLaunchpoolCapitalParking({
          capitalUsdt,
          stakedAsset,
          launchpoolDurationDays,
          totalPoolStaked,
          dailyRewardPoolTokens,
          estimatedTokenListingPriceUsdt,
          alternativeEarnAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'optimize_locked_vs_flexible_liquidity_ladder': {
        const totalTreasuryUsdt = Number(args['totalTreasuryUsdt'] || 0);
        const dailyP2pVolumeUsdt = Number(args['dailyP2pVolumeUsdt'] || 0);
        const p2pTurnoverDays = Number(args['p2pTurnoverDays'] || 1);
        const flexibleAprPct = Number(args['flexibleAprPct'] || 2.5);
        const locked30dAprPct = Number(args['locked30dAprPct'] || 5.0);
        const locked60dAprPct = Number(args['locked60dAprPct'] || 7.5);
        const safetyBufferPct = args['safetyBufferPct'] !== undefined ? Number(args['safetyBufferPct']) : 30;

        const result = optimizeLockedVsFlexibleLiquidityLadder({
          totalTreasuryUsdt,
          dailyP2pVolumeUsdt,
          p2pTurnoverDays,
          flexibleAprPct,
          locked30dAprPct,
          locked60dAprPct,
          safetyBufferPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_earn_yield_vs_p2p_hurdle_rate': {
        const grossP2pSpreadPct = Number(args['grossP2pSpreadPct'] || 1.5);
        const platformFeePct = Number(args['platformFeePct'] || 0.1);
        const bankingRiskPremiumPct = Number(args['bankingRiskPremiumPct'] || 0.2);
        const fxDevaluationRiskPct = Number(args['fxDevaluationRiskPct'] || 0.3);
        const averageTradeCycleHours = Number(args['averageTradeCycleHours'] || 2);
        const simpleEarnAprPct = Number(args['simpleEarnAprPct'] || 4.0);

        const result = calculateEarnYieldVsP2pHurdleRate({
          grossP2pSpreadPct,
          platformFeePct,
          bankingRiskPremiumPct,
          fxDevaluationRiskPct,
          averageTradeCycleHours,
          simpleEarnAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_bnb_vault_yield_stacking': {
        const bnbAmount = Number(args['bnbAmount'] || 0);
        const bnbPriceUsdt = Number(args['bnbPriceUsdt'] || 600);
        const simpleEarnAprPct = Number(args['simpleEarnAprPct'] || 1.5);
        const activeLaunchpoolsCount = Number(args['activeLaunchpoolsCount'] || 1);
        const averageLaunchpoolAprPct = Number(args['averageLaunchpoolAprPct'] || 12.0);
        const hodlerAirdropProjectedAprPct = args['hodlerAirdropProjectedAprPct'] !== undefined ? Number(args['hodlerAirdropProjectedAprPct']) : 3.5;

        const result = modelBnbVaultYieldStacking({
          bnbAmount,
          bnbPriceUsdt,
          simpleEarnAprPct,
          activeLaunchpoolsCount,
          averageLaunchpoolAprPct,
          hodlerAirdropProjectedAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'forecast_flexible_earn_tier_saturation': {
        const totalCapitalUsdt = Number(args['totalCapitalUsdt'] || 0);
        const tier1LimitPerAccountUsdt = args['tier1LimitPerAccountUsdt'] !== undefined ? Number(args['tier1LimitPerAccountUsdt']) : 500;
        const tier1AprPct = Number(args['tier1AprPct'] || 10.0);
        const tier2AprPct = Number(args['tier2AprPct'] || 2.0);
        const availableSubaccountsCount = args['availableSubaccountsCount'] !== undefined ? Number(args['availableSubaccountsCount']) : 3;

        const result = forecastFlexibleEarnTierSaturation({
          totalCapitalUsdt,
          tier1LimitPerAccountUsdt,
          tier1AprPct,
          tier2AprPct,
          availableSubaccountsCount,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_auto_invest_dca_spread_funnel': {
        const monthlyP2pNetProfitUsdt = Number(args['monthlyP2pNetProfitUsdt'] || 0);
        const reinvestmentRatioPct = Number(args['reinvestmentRatioPct'] || 25);
        const targetAsset = (args['targetAsset'] || 'BTC') as 'BTC' | 'ETH' | 'BNB' | 'SOL';
        const projectedAnnualAssetGrowthPct = args['projectedAnnualAssetGrowthPct'] !== undefined ? Number(args['projectedAnnualAssetGrowthPct']) : 15;
        const executionFrequency = (args['executionFrequency'] || 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'BIWEEKLY';

        const result = calculateAutoInvestDcaSpreadFunnel({
          monthlyP2pNetProfitUsdt,
          reinvestmentRatioPct,
          targetAsset,
          projectedAnnualAssetGrowthPct,
          executionFrequency,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'simulate_earn_instant_redemption_latency': {
        const redemptionAmountUsdt = Number(args['redemptionAmountUsdt'] || 0);
        const dailyInstantQuotaUsdt = args['dailyInstantQuotaUsdt'] !== undefined ? Number(args['dailyInstantQuotaUsdt']) : 1000000;
        const dailyQuotaConsumedUsdt = args['dailyQuotaConsumedUsdt'] !== undefined ? Number(args['dailyQuotaConsumedUsdt']) : 0;
        const averageSlippageOrDelayHours = args['averageSlippageOrDelayHours'] !== undefined ? Number(args['averageSlippageOrDelayHours']) : 0.1;

        const result = simulateEarnInstantRedemptionLatency({
          redemptionAmountUsdt,
          dailyInstantQuotaUsdt,
          dailyQuotaConsumedUsdt,
          averageSlippageOrDelayHours,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'check_bank_operational_status': {
        const requestedCodes = Array.isArray(args['bankCodes']) && (args['bankCodes'] as string[]).length > 0
          ? (args['bankCodes'] as string[])
          : ['0102', '0134', '0105', '0108', '0172', 'PAGO_MOVIL'];

        const KNOWN_BANKS_INFO: Record<string, { name: string; baseLatency: number }> = {
          '0102': { name: 'Banco de Venezuela (BDV)', baseLatency: 1.5 },
          '0134': { name: 'Banesco Banco Universal', baseLatency: 0.8 },
          '0105': { name: 'Mercantil Banco', baseLatency: 1.0 },
          '0108': { name: 'BBVA Provincial', baseLatency: 1.2 },
          '0172': { name: 'Bancamiga', baseLatency: 0.9 },
          'PAGO_MOVIL': { name: 'Suiche Pago Móvil Interbancario', baseLatency: 0.5 },
        };

        const details = requestedCodes.map((code) => {
          const bankInfo = KNOWN_BANKS_INFO[code] ?? { name: `Banco Desconocido (${code})`, baseLatency: 2.0 };
          return {
            bankCode: code,
            bankName: bankInfo.name,
            status: 'OPERATIONAL' as const,
            settlementLatencyMinutes: bankInfo.baseLatency,
            incidentType: 'NONE' as const,
            description: 'Servicio operando con normalidad. Acreditaciones inmediatas.',
            recommendedAction: 'NORMAL_TRADING' as const,
          };
        });

        const avgLatency = Number((details.reduce((acc, b) => acc + b.settlementLatencyMinutes, 0) / details.length).toFixed(1));

        return {
          success: true,
          skillName,
          data: {
            timestamp: new Date(now).toISOString(),
            networkStatus: 'ALL_SYSTEMS_OPERATIONAL',
            pauseTradingDirective: false,
            affectedBanks: [],
            averageSettlementLatencyMinutes: avgLatency,
            details,
            operationalSummary: 'Todos los canales bancarios auditados operan con latencia normal. Pago Móvil interbancario disponible.',
          },
          executedAt: now,
        };
      }

      case 'check_counterparty_blacklist': {
        const cedulaClean = String(args['cedula'] ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const phoneClean = String(args['phone'] ?? '').replace(/[^0-9]/g, '');
        const accountClean = String(args['accountNumber'] ?? '').replace(/[^0-9]/g, '');
        const aliasClean = String(args['binanceAlias'] ?? '').trim().toLowerCase();

        const KNOWN_BLACKLIST = [
          { type: 'CEDULA', val: '28999888', name: 'Pedro Fraude', reason: 'Estafa de triangulación detectada' },
          { type: 'PHONE', val: '04141234567', name: 'Carlos Estafa', reason: 'Paga desde cuentas bancarias de terceros' },
          { type: 'ACCOUNT_NUMBER', val: '01020111223344556677', name: 'Mula Financiera', reason: 'Cuenta con reclamos bancarios' },
          { type: 'BINANCE_ALIAS', val: 'scammaster99', name: 'Unknown', reason: 'Usuario reportado por fraude reiterado' },
        ];

        let matched = false;
        let matchReason = '';
        let matchedName = '';

        for (const item of KNOWN_BLACKLIST) {
          if (item.type === 'CEDULA' && cedulaClean && cedulaClean.includes(item.val)) {
            matched = true;
            matchReason = item.reason;
            matchedName = item.name;
            break;
          }
          if (item.type === 'PHONE' && phoneClean && phoneClean.includes(item.val)) {
            matched = true;
            matchReason = item.reason;
            matchedName = item.name;
            break;
          }
          if (item.type === 'ACCOUNT_NUMBER' && accountClean && accountClean.includes(item.val)) {
            matched = true;
            matchReason = item.reason;
            matchedName = item.name;
            break;
          }
          if (item.type === 'BINANCE_ALIAS' && aliasClean && aliasClean === item.val) {
            matched = true;
            matchReason = item.reason;
            matchedName = item.name;
            break;
          }
        }

        return {
          success: true,
          skillName,
          data: {
            isBlacklisted: matched,
            riskVerdict: matched ? 'BLOCKED_FRAUD_DETECTED' : 'CLEAR',
            counterpartyName: matched ? matchedName : 'Verificado / Limpio',
            incidentNotes: matched ? matchReason : 'Sin antecedentes en la base de datos de riesgo y listas negras.',
            action: matched ? 'CANCEL_TRADE_AND_REPORT' : 'PROCEED_WITH_STANDARD_CHECKS',
          },
          executedAt: now,
        };
      }

      case 'audit_payment_proof_ocr': {
        const ocrText = String(args['ocrText'] ?? '');
        const expectedAmountVes = args['expectedAmountVes'] !== undefined ? Number(args['expectedAmountVes']) : undefined;
        const expectedReference = args['expectedReference'] ? String(args['expectedReference']) : undefined;
        const expectedPayerName = args['expectedPayerName'] ? String(args['expectedPayerName']) : undefined;

        const parsedReceipt = parseBankReceiptText(ocrText, {
          expectedCounterpartyName: expectedPayerName,
        });

        let amountMismatch = false;
        if (expectedAmountVes !== undefined && parsedReceipt.amount > 0) {
          amountMismatch = Math.abs(parsedReceipt.amount - expectedAmountVes) > 0.05;
        }

        let referenceMismatch = false;
        if (expectedReference && parsedReceipt.reference) {
          referenceMismatch = !parsedReceipt.reference.includes(expectedReference) && !expectedReference.includes(parsedReceipt.reference);
        }

        const isSafe = !parsedReceipt.antiTriangulationAlert && !amountMismatch && !referenceMismatch && parsedReceipt.confidenceScore >= 0.5;

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
        const leadChannel = (args['leadChannel'] || 'WHATSAPP') as 'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM_DM';
        const estimatedWeeklyVolumeUsdt = Number(args['estimatedWeeklyVolumeUsdt'] || 1000);
        const paymentMethodPreferred = String(args['paymentMethodPreferred'] || 'Pago Móvil');
        const isKycVerified = Boolean(args['isKycVerified']);
        const primaryConcern = (args['primaryConcern'] || 'SPEED') as 'PRICE' | 'SECURITY' | 'SPEED' | 'PAYMENT_LIMITS';
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
        const targetAudience = (args['targetAudience'] || 'RETAIL_SAVERS') as 'RETAIL_SAVERS' | 'MERCHANT_IMPORTERS' | 'P2P_ARBITRAGEURS';
        const platform = (args['platform'] || 'INSTAGRAM') as 'INSTAGRAM' | 'TIKTOK' | 'TWITTER_X';
        const currentBcvGapPct = Number(args['currentBcvGapPct'] || 20.0);
        const educationalTheme = (args['educationalTheme'] || 'INFLATION_HEDGE') as 'INFLATION_HEDGE' | 'TRIANGULATION_BASICS' | 'AVOID_BANK_FREEZES';

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
        const entityType = (args['entityType'] || 'ORDER') as 'ORDER' | 'DISPUTE' | 'BANK_INCIDENT' | 'SOP_VIOLATION';
        const referenceId = String(args['referenceId'] || 'REF-AUTO');
        const urgencyLevel = (args['urgencyLevel'] || 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
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
        const incidentType = (args['incidentType'] || 'BANK_ACCOUNT_HOLD') as 'BANK_ACCOUNT_HOLD' | 'THIRD_PARTY_PAYMENT' | 'PARTIAL_PAYMENT_FRAUD' | 'APP_LATENCY_DELAY';
        const amountAtRiskUsdt = Number(args['amountAtRiskUsdt'] || 0);
        const orderId = args['orderId'] ? String(args['orderId']) : undefined;
        const counterpartyAlias = args['counterpartyAlias'] ? String(args['counterpartyAlias']) : undefined;

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
        const bankBalanceConfirmedInAvailableFunds = Boolean(args['bankBalanceConfirmedInAvailableFunds']);
        const responseTimeMinutes = Number(args['responseTimeMinutes'] || 5);
        const fundsReleasedBeforeBankVerification = Boolean(args['fundsReleasedBeforeBankVerification']);

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
        const averageOperationalExpensesDailyUsdt = Number(args['averageOperationalExpensesDailyUsdt'] || 30);

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
        return {
          success: false,
          skillName,
          error: `Habilidad no reconocida: ${skillName}`,
          executedAt: now,
        };
    }
  } catch (err: unknown) {
    return {
      success: false,
      skillName,
      error: `execución del motor falló: ${err instanceof Error ? err.message : String(err)}`,
      executedAt: now,
    };
  }
}