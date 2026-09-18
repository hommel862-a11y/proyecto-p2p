/**
 * Rates Resources — Endpoints de lectura de tasas oficiales y paralelas para agentes IA.
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
      'Tasas de cambio oficiales publicadas por el Banco Central de Venezuela (USD, EUR, CNY, RUB)',
    mimeType: 'application/json',
    read: () => {
      return getOfficialBcvRates(true);
    },
  },
  {
    uri: 'p2p://rates/parallel',
    name: 'Monitores Paralelos Consolidados',
    description:
      'Cotizaciones en vivo desde Binance P2P, CotizaVe, EnParaleloVzla y CriptoNoticias con estadísticas de dispersión',
    mimeType: 'application/json',
    read: () => {
      return getParallelRatesFeed();
    },
  },
  {
    uri: 'p2p://rates/gap-analysis',
    name: 'Análisis de Brecha y Ciclo BCV',
    description:
      'Brecha actual entre paralelo y oficial BCV junto a la ventana de intervención de subastas bancarias',
    mimeType: 'application/json',
    read: () => {
      const bcv = getOfficialBcvRates(true);
      const parallel = getParallelRatesFeed();
      const parallelMid = parallel.summary.averageMid;
      const gap = calculateBcvGap(parallelMid, bcv.usd);
      const window = predictBcvIntervention(new Date());

      return {
        timestamp: new Date().toISOString(),
        gap,
        window,
        summary: `Brecha: ${gap.gapPct}% (${gap.zone}) · Fase BCV: ${window.phase} (${window.probabilityPct}% prob)`,
      };
    },
  },
];
