import { getOfficialBcvRates } from '../core/index.js';
import { GetBcvRatesInputSchema, type GetBcvRatesInput } from '../schemas/index.js';

export const getBcvRatesTool = {
  name: 'get_bcv_rates',
  description: 'Consulta las tasas oficiales del Banco Central de Venezuela (USD, EUR, CNY, RUB) y fecha valor vigente.',
  inputSchema: GetBcvRatesInputSchema,
  execute: (input: GetBcvRatesInput) => {
    const rates = getOfficialBcvRates(input.cacheFallback);

    return {
      usd: rates.usd,
      eur: rates.eur,
      cny: rates.cny,
      rub: rates.rub,
      effectiveDate: rates.effectiveDate,
      source: rates.source,
      isFallback: rates.isFallback,
      timestamp: rates.timestamp,
      description: `Tasa oficial BCV USD: ${rates.usd.toFixed(2)} VES · EUR: ${rates.eur.toFixed(2)} VES`,
    };
  },
};
