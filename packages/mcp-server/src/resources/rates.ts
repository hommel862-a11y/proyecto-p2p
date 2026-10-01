/**
 * Rates Resources — Endpoints de lectura de tasas oficiales y paralelas para agentes IA.
 *
 * Estos recursos son de sólo lectura y nunca fabrican una tasa: si el feed no
 * respondió, declaran la ausencia yDevuelven los campos en `null`.
 */

import {
  getOfficialBcvRates,
  getParallelRatesFeed,
  calculateBcvGap,
  predictBcvIntervention,
} from '../core/index.js';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<unknown> | unknown;
}

export const ratesResources: McpResource[] = [
  {
    uri: 'p2p://rates/bcv',
    name: 'Tasas Oficiales BCV',
    description:
      'Tasas de cambio oficiales publicadas por el Banco Central de Venezuela (USD, EUR, CNY, RUB). Sin feed en vivo devuelve la ausencia, no una tasa de ejemplo.',
    mimeType: 'application/json',
    read: () => {
      return getOfficialBcvRates(true);
    },
  },
  {
    uri: 'p2p://rates/parallel',
    name: 'Monitores Paralelos Consolidados',
    description:
      'Cotizaciones de los monitores que fueron realmente consultados (hoy Binance P2P vía endpoint público) con estadísticas de dispersión. Sin lectura devuelve `sources: {}` y el resumen en `null`.',
    mimeType: 'application/json',
    read: () => {
      return getParallelRatesFeed();
    },
  },
  {
    uri: 'p2p://rates/gap-analysis',
    name: 'Análisis de Brecha y Ciclo BCV',
    description:
      'Brecha entre paralelo y oficial BCV junto a la ventana de intervención de subastas bancarias. Sin ambas tasas devuelve `zone: UNAVAILABLE` y `gapPct: null`; nunca hay probabilidad de intervención.',
    mimeType: 'application/json',
    read: () => {
      const bcv = getOfficialBcvRates(true);
      const parallel = getParallelRatesFeed();
      const gap = calculateBcvGap(parallel.summary.averageMid, bcv.usd);
      const window = predictBcvIntervention(new Date());

      const nd = (value: number | null, decimals = 2): string =>
        value == null ? 'N/D' : value.toFixed(decimals);

      return {
        timestamp: new Date().toISOString(),
        gap,
        window,
        summary:
          gap.unavailableReason == null
            ? `Brecha: ${nd(gap.gapPct)}% (${gap.zone}) · Fase BCV: ${window.phase} · Probabilidad de intervención: N/D (${window.probabilityBasis})`
            : `Brecha indeterminada (${gap.unavailableReason}) · Fase BCV: ${window.phase} · Probabilidad de intervención: N/D (${window.probabilityBasis})`,
      };
    },
  },
];