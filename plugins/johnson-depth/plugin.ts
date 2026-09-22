/**
 * Plugin Johnson Market Depth — adaptador delgado sobre el motor @p2p/core.
 *
 * Toda la lógica vive en projects/core/src/lib/johnson-depth.ts.
 * Este archivo solo conecta el motor con el integrador (Spread Monitor o
 * PluginRegistryImpl). No contiene fórmulas.
 *
 * Diferencias vs el v1 roto:
 * - Ya NO usa `context.marketDepth.subscribe()` (el registry pasa un objeto
 *   placeholder no-Signal). El integrador llama `refresh(depth)` con cada snapshot real.
 * - Implementa `cleanup()` porque PluginRegistryImpl.unloadPlugin() lo invoca.
 * - Implementa `maxConsecutiveErrors` (gobernanza real, no decorativa).
 */
import {
  buildJohnsonMarketQuality,
  DEFAULT_JOHNSON_REQUIREMENTS,
  computeVolumeWeightedPrice,
  type JohnsonDepthRequirements,
  type JohnsonMarketQuality,
  type JohnsonBankConfig,
  type JohnsonBankProfit,
} from '../../projects/core/src/public-api';
import type { BinanceP2pMarketDepth } from '../../projects/core/src/public-api';

export const pluginMetadata = {
  id: 'johnson-depth',
  name: 'Johnson Market Depth',
  version: '2.0.0',
  description:
    'Motor de calidad de profundidad: scoring, ganancia neta por banco y señal de operación.',
  entryPoint: './plugin.ts',
  requirements: {
    minSpread: DEFAULT_JOHNSON_REQUIREMENTS.minSpread,
    minLiquidityUsdt: DEFAULT_JOHNSON_REQUIREMENTS.minLiquidityUsdt,
    maxConsecutiveErrors: DEFAULT_JOHNSON_REQUIREMENTS.maxConsecutiveErrors,
  },
};

export interface JohnsonPluginContext {
  storage?: {
    get?: (key: string) => unknown;
    set?: (key: string, value: unknown) => void;
  };
  marketDepth?: { depth?: BinanceP2pMarketDepth | null };
  setMarketQuality?: (quality: JohnsonMarketQuality) => void;
  registerCustomMetric?: (name: string, value: unknown) => void;
  requirements?: Partial<JohnsonDepthRequirements>;
}

/** Bancos válidos (claves de BankCode con tabla de fees; D4). PAGO_MOVIL/ALL quedan fuera. */
export const BANK_KEYS: readonly string[] = [
  'BANESCO',
  'MERCANTIL',
  'BDV',
  'BANCAMIGA',
  'PROVINCIAL',
];
/** Filtros anti-fake recomendados (ver Task 1). */
export const PLUGIN_OPTIONS = { minFinishRatePct: 90, maxPriceDeviationFactor: 3 } as const;

export { computeVolumeWeightedPrice, type JohnsonBankProfit };

let latestQuality: JohnsonMarketQuality | null = null;
let lastError: string | null = null;
let consecutiveErrors = 0;

export function getLatestQuality(): JohnsonMarketQuality | null {
  return latestQuality;
}

export function getLastError(): string | null {
  return lastError;
}

export function refresh(
  depth: BinanceP2pMarketDepth | null | undefined,
  ctx: JohnsonPluginContext = {},
): JohnsonMarketQuality | null {
  const req: JohnsonDepthRequirements = {
    ...DEFAULT_JOHNSON_REQUIREMENTS,
    ...(ctx.requirements ?? {}),
  };
  const bankConfig: JohnsonBankConfig = {
    bankCodes: BANK_KEYS,
    buyRole: 'TAKER',
    sellRole: 'TAKER',
    isInterbank: false,
  };

  if (!depth || !depth.bestBuyPrice || !depth.bestSellPrice) {
    consecutiveErrors += 1;
    lastError = `depth inválido o vacío (error consecutivo ${consecutiveErrors})`;
    if (consecutiveErrors > req.maxConsecutiveErrors) {
      const degraded: JohnsonMarketQuality = {
        depthScore: 0,
        liquidityScore: 0,
        spreadVes: 0,
        spreadPct: 0,
        recommendation: 'AVOID',
        bestBank: null,
        bankProfits: [],
        timestamp: Date.now(),
      };
      latestQuality = degraded;
      ctx.setMarketQuality?.(degraded);
    }
    return null;
  }

  consecutiveErrors = 0;
  lastError = null;

  const quality = buildJohnsonMarketQuality(depth, BANK_KEYS, req, bankConfig);
  latestQuality = quality;

  ctx.setMarketQuality?.(quality);
  ctx.registerCustomMetric?.('johnsonDepthScore', quality.depthScore);
  ctx.registerCustomMetric?.('johnsonSignal', quality.recommendation);
  ctx.registerCustomMetric?.('johnsonBestBank', quality.bestBank ?? '');

  return quality;
}

export async function init(context: JohnsonPluginContext = {}): Promise<void> {
  console.log('[johnson-depth] init() ejecutándose (adaptador v2)');
  try {
    const initial = context.marketDepth?.depth;
    if (initial) refresh(initial, context);
  } catch (err) {
    console.warn('[johnson-depth] init() sin depth inicial; listo para refresh() manual:', err);
  }
  console.log('[johnson-depth] init() completado — usar refresh(depth) para nuevas lecturas');
}

/** Cajón de salida — obligatorio para desinstalación limpia (PluginRegistryImpl.unloadPlugin). */
export async function cleanup(): Promise<void> {
  latestQuality = null;
  lastError = null;
  consecutiveErrors = 0;
  console.log('[johnson-depth] cleanup() ejecutado — estado reseteado');
}
