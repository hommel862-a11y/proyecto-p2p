/**
 * Plugin Johnson Depth Tools
 * Un plugin de ejemplo para el system de integración cada 2 horas
 * Proporciona análisis avanzado de profundidad de mercado con scoring
 *
 * Este plugin forma parte del sistema Plugin Registry implementado en Paso 1.
 * Se carga dinámicamente vía PluginAutoLoaderService cada 2 horas.
 */

// Metadato requerido por el Plugin Registry
export const pluginMetadata = {
  id: 'johnson-depth',
  name: 'Johnson Market Depth',
  version: '1.0.0',
  description: 'Herramientas avanzadas de profundidad de mercado con scoring de calidad y señales de operación',
  entryPoint: './plugin.ts',
  requirements: {
    minSpread: 0.3,      // Spread mínimo en VES para activar señales
    minLiquidityUsdt: 500, // Liquidez mínima en USDT por precio nivel
    maxConsecutiveErrors: 2, // Máximo errores consecutivos antes de pause
  },
};

/**
 * Función init: Se ejecuta cuando el Plugin Registry carga este módulo
 * @param context - Contexto del sistema P2P Decisor
 */
export async function init(context: {
  /** Adaptador de storage localStorage / MemoryStorage */
  storage: {
    get: (key: string) => any | null;
    set: (key: string, value: any) => void;
    remove: (key: string) => void;
    exportAll: () => string;
    importAll: (json: string) => void;
  };
  /** Contexto actual del motor de reglas */
  rules: {
    evaluate: (ctx: any) => any;
    ALLOW: string;
    DENY: string;
    PAUSE: string;
    RULE_RESON: {
      MIN_SPREAD: string;
      CONSECUTIVE_ERRORS: string;
      OK: string;
    };
  };
  /** Señal actual de marketDepth del servicio Binance P2P */
  marketDepth: any;
  /** Función para establecer quality de mercado */
  setMarketQuality: (quality: any) => void;
  /** Para registrar métricas personalizadas en el reglas motor */
  registerCustomMetric: (name: string, value: any) => void;
}) => {
  console.log('[johnson-depth] Plugin init() ejecutándose...');

  // 1. Suscribirse a cambios del marketDepth existente
  context.marketDepth.subscribe((depth: any) => {
    if (!depth) return;

    // 2. Calcular scoring de calidad de profundidad
    const qualityScore = calculateDepthQuality(depth);

    // 3. Determinar señal de operación
    const signal = determineSignal(depth, qualityScore);

    // 4. Establecer quality de mercado para la UI/spread-monitor
    context.setMarketQuality({
      spreadVes: depth.spreadVes || 0,
      spreadUsdt: depth.spreadUsdt || 0,
      depthScore: qualityScore,
      liquidityScore: calculateLiquidityScore(depth),
      recommendation: signal,
      timestamp: Date.now(),
    });

    // 5. Registrar métrica personalizada para el motor de reglas
    context.registerCustomMetric('johnsonDepthScore', qualityScore);
    context.registerCustomMetric('johnsonSignal', signal);
  });

  // 6. Exponer nuevo evento en el componente spread-monitor
  // (esto será conectado en el HTML del spread-monitor)
  // window.dispatchEvent(new CustomEvent('johnson-depth-signal', {
  //   detail: { score: qualityScore, signal }
  // }));

  console.log('[johnson-depth] Plugin init() completado - profundidad monitorizada');
};

/**
 * calculateDepthQuality: Evalúa la calidad del market depth
 * @param depth - Objeto marketDepth con buy/sell volumes
 * @returns number score 0-100 (mayor es mejor)
 */
function calculateDepthQuality(depth: any): number {
  if (!depth.bestBuyPrice || !depth.bestSellPrice) return 0;

  // Factores:
  // 1. Ratio de volumen buy/sell (50% weight)
  const volumeRatio = depth.buyVolumeAtPrice
    ? Math.min(depth.buyVolumeAtPrice / (depth.sellVolumeAtPrice || 1), 1) * 100
    : 50;

  // 2. Profundidad relativa al spread (30% weight)
  const spreadDepthRatio = depth.spreadVes
    ? Math.max(0, 100 - Math.abs(depth.spreadVes) * 10) // spread alto = score bajo
    : 50;

  // 3. Precio dentro de rango viable (20% weight)
  const priceInRange = depth.bestBuyPrice > 0 && depth.bestSellPrice > 0 ? 100 : 0;

  // Promedio ponderado
  const quality = (volumeRatio * 0.5) + (spreadDepthRatio * 0.3) + (priceInRange * 0.2);
  return Math.round(Math.max(0, Math.min(100, quality)));
}

/**
 * calculateLiquidityScore: Evalúa si hay suficiente liquidez
 * @param depth - marketDepth object
 * @returns number 0-100
 */
function calculateLiquidityScore(depth: any): number {
  const minLiquidity = context.requirements?.minLiquidityUsdt || 500;
  const avgVolume = (depth.buyVolumeAtPrice?.reduce((a: number, b: number) => a + b, 0) || 0 +
                    depth.sellVolumeAtPrice?.reduce((a: number, b: number) => a + b, 0) || 0) / 2;

  if (avgVolume >= minLiquidity * 2) return 100;
  if (avgVolume >= minLiquidity) return 75;
  if (avgVolume >= minLiquidity / 2) return 50;
  if (avgVolume > 0) return 25;
  return 0;
}

/**
 * determineSignal: Decide la señal de operación basada en profundidad y quality
 * @param depth - marketDepth object
 * @param qualityScore - score 0-100 de calculateDepthQuality
 * @returns 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID'
 */
function determineSignal(depth: any, qualityScore: number): 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID' {
  const minSpread = context.requirements?.minSpread || 0.3;

  // Si el spread es muy bajo, evitar siempre
  if (depth.spreadVes && depth.spreadVes < minSpread) {
    return 'AVOID';
  }

  // Si quality score es alto y spread es favorable
  if (qualityScore >= 80 && depth.spreadVes && depth.spreadVes >= minSpread) {
    return 'STRONG_BUY';
  }

  if (qualityScore >= 60 && depth.spreadVes && depth.spreadVes >= minSpread) {
    return 'BUY';
  }

  if (qualityScore >= 40) {
    return 'CAUTION';
  }

  return 'AVOID';
}

/* ============================= EJEMPLO DE USO EN SPREAD-MONITOR =============================
// En spread-monitor.component.ts, después de importar el plugin:

/*
import { pluginMetadata, init } from '@p2p/core'; // Ahora posible por export public-api

// En ngOnInit:
init({
  storage: { /* adaptadores * / },
  rules: { /* contexto rules * / },
  marketDepth: this.binance.marketDepth(), // signal existente
  setMarketQuality: (q) => this.marketQuality.set(q),
  registerCustomMetric: (name, value) => {
    // almacenar en localStorage o servicio de stats
    console.log(`[johnson-depth] Métrica: ${name} = ${value}`);
  },
});

// En spread-monitor.html, agregar al final:
<div *ngIf="marketQuality()" class="johnson-depth-panel">
  <h4>Análisis Johnson</h4>
  <p>Score de profundidad: {{ marketQuality().depthScore }}</p>
  <p>Liquidez: {{ marketQuality().liquidityScore }}</p>
  <p>Recomendación: {{ marketQuality().recommendation | uppercase }}</p>
</div>
*/

/* ========================================================================== */
/* FIN DEL PLUGIN JOHSON DEPTH TOOLS */
/*===========================================================================*/