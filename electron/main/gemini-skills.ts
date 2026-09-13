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
import type { BankType } from './vendor/p2p-core/receipt-ocr';
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
} from './vendor/p2p-core/triangular-arbitrage';
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