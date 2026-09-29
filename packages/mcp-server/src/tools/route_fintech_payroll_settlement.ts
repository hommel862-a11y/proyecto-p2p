import {
  calculateFintechSettlementQuote,
  type FintechSettlementRequest,
} from '../core/index.js';
import {
  RouteFintechPayrollSettlementInputSchema,
  type RouteFintechPayrollSettlementInput,
} from '../schemas/index.js';

export const routeFintechPayrollSettlementTool = {
  name: 'route_fintech_payroll_settlement',
  description:
    'Enruta y cotiza liquidaciones de nóminas internacionales y pagos remotos (Deel, Wise, Payoneer, Stripe, PayPal) hacia USDT, VES o efectivo.',
  inputSchema: RouteFintechPayrollSettlementInputSchema,
  execute: (input: RouteFintechPayrollSettlementInput) => {
    const quote = calculateFintechSettlementQuote({
      platform: input.platform,
      grossAmountUsd: input.grossAmountUsd,
      payoutRail: input.payoutRail,
      vesRatePerUsd: input.vesRatePerUsd,
      clientTier: input.clientTier,
      isVerifiedContractor: input.isVerifiedContractor,
    });

    return {
      success: true,
      quote,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
