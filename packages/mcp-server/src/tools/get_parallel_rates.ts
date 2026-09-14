import { getParallelRatesFeed } from '../core/index.js';
import { GetParallelRatesInputSchema, type GetParallelRatesInput } from '../schemas/index.js';

export const getParallelRatesTool = {
  name: 'get_parallel_rates',
  description: 'Obtiene cotizaciones paralelas del dólar en Venezuela consolidadas desde múltiples monitores (Binance P2P, CotizaVe, EnParaleloVzla, CriptoNoticias).',
  inputSchema: GetParallelRatesInputSchema,
  execute: (input: GetParallelRatesInput) => {
    const feed = getParallelRatesFeed(input.includeSources);

    return {
      timestamp: feed.timestamp,
      sourcesCount: Object.keys(feed.sources).length,
      sources: feed.sources,
      summary: feed.summary,
      recommendation: `Punto medio ponderado: ${feed.summary.averageMid.toFixed(2)} VES · Dispersión entre monitores: ${feed.summary.dispersionPct.toFixed(2)}%`,
    };
  },
};
