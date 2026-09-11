/**
 * Pure Triangular Arbitrage and Cross-Currency domain engine.
 * Computes 3-leg conversion paths (e.g. VES -> USDT -> COP -> VES or USDT -> USD -> VES -> USDT),
 * deducting percentage fees, fixed platform costs, and banking transfer tariffs (e.g. 4x1000).
 * Framework-agnostic. No network, no Angular.
 */

import { roundMoney } from './money';

export type CurrencyType = 'CRYPTO' | 'FIAT' | 'DIGITAL_WALLET';

export interface CurrencyMetadata {
  symbol: string;
  name: string;
  type: CurrencyType;
  decimals: number;
}

export const SUPPORTED_CURRENCIES: Record<string, CurrencyMetadata> = {
  USDT: { symbol: 'USDT', name: 'Tether USD', type: 'CRYPTO', decimals: 2 },
  VES: { symbol: 'VES', name: 'Bolívar Digital', type: 'FIAT', decimals: 2 },
  COP: { symbol: 'COP', name: 'Peso Colombiano', type: 'FIAT', decimals: 0 },
  USD: { symbol: 'USD', name: 'Dólar Estadounidense', type: 'FIAT', decimals: 2 },
  EUR: { symbol: 'EUR', name: 'Euro', type: 'FIAT', decimals: 2 },
  BRL: { symbol: 'BRL', name: 'Real Brasileño', type: 'FIAT', decimals: 2 },
};

export type LegOperationType = 'BUY_CRYPTO' | 'SELL_CRYPTO' | 'FIAT_CONVERSION' | 'WALLET_TRANSFER';

export interface ExchangeLeg {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  operationType: LegOperationType;
  platform: string; // e.g., 'Binance P2P', 'Zinli', 'Bancolombia', 'El Dorado'
  paymentMethod: string; // e.g., 'Pago Móvil', 'Transferencia Directa', 'Nequi'
  price: number; // Quote rate (units of quote per unit of base)
  /**
   * If true, output = input / price. (e.g. buying USDT with VES: 82,000 VES / 82 VES/USDT = 1,000 USDT)
   * If false, output = input * price. (e.g. selling USDT for COP: 1,000 USDT * 4,200 COP/USDT = 4,200,000 COP)
   */
  isDivision: boolean;
  feePct: number; // e.g., 0.35 for 0.35%
  fixedFee: number; // e.g., 1.00 USDT or 50 VES
  fixedFeeCurrency: string;
  estimatedDurationMinutes: number;
  /**
   * Optional banking friction fees (e.g., 4x1000 GMF in Colombia = 0.4%, interbank wire tariffs)
   */
  bankingFeePct?: number;
  bankingFixedFee?: number;
}

export interface StepSimulation {
  step: number;
  fromCurrency: string;
  toCurrency: string;
  platform: string;
  paymentMethod: string;
  inputAmount: number;
  price: number;
  percentageFeeAmount: number;
  fixedFeeAmount: number;
  bankingFeeAmount: number;
  outputAmount: number;
  effectiveRate: number;
}

export type TriangularRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TriangularArbitrageResult {
  routeId: string;
  routeName: string;
  initialCurrency: string;
  initialAmount: number;
  finalAmount: number;
  netProfit: number;
  roiPct: number;
  isProfitable: boolean;
  totalDurationMinutes: number;
  projectedTurnoverHours: number;
  hourlyRoiPct: number;
  breakevenPriceLeg3: number;
  slippageTolerancePct: number;
  riskLevel: TriangularRiskLevel;
  riskReasons: string[];
  steps: [StepSimulation, StepSimulation, StepSimulation];
  calculatedAt: string;
}

export interface TriangularRoutePreset {
  id: string;
  name: string;
  description: string;
  initialCurrency: string;
  legs: [ExchangeLeg, ExchangeLeg, ExchangeLeg];
}

/**
 * Execute a step conversion deducting fees.
 */
export function simulateLeg(amount: number, leg: ExchangeLeg): StepSimulation {
  if (amount <= 0 || leg.price <= 0) {
    return {
      step: 1,
      fromCurrency: leg.fromCurrency,
      toCurrency: leg.toCurrency,
      platform: leg.platform,
      paymentMethod: leg.paymentMethod,
      inputAmount: amount,
      price: leg.price,
      percentageFeeAmount: 0,
      fixedFeeAmount: 0,
      bankingFeeAmount: 0,
      outputAmount: 0,
      effectiveRate: 0,
    };
  }

  // 1. Convert base
  const grossConverted = leg.isDivision ? amount / leg.price : amount * leg.price;

  // 2. Compute platform percentage fee
  const percentageFee = grossConverted * (Math.max(0, leg.feePct) / 100);

  // 3. Compute banking friction fee (e.g. 4x1000 GMF = 0.4% or wire tariffs)
  const bankingFeePctAmount = grossConverted * (Math.max(0, leg.bankingFeePct ?? 0) / 100);
  const bankingFixedFeeAmount = leg.bankingFixedFee
    ? leg.fixedFeeCurrency === leg.toCurrency
      ? leg.bankingFixedFee
      : leg.isDivision
        ? leg.bankingFixedFee / leg.price
        : leg.bankingFixedFee * leg.price
    : 0;
  const totalBankingFee = bankingFeePctAmount + Math.max(0, bankingFixedFeeAmount);

  // 4. Fixed platform fee
  const fixedFee =
    leg.fixedFeeCurrency === leg.toCurrency
      ? leg.fixedFee
      : leg.isDivision
        ? leg.fixedFee / leg.price
        : leg.fixedFee * leg.price;

  const totalFeeInOutput = percentageFee + Math.max(0, fixedFee) + totalBankingFee;
  const netOutput = Math.max(0, grossConverted - totalFeeInOutput);

  return {
    step: 1,
    fromCurrency: leg.fromCurrency,
    toCurrency: leg.toCurrency,
    platform: leg.platform,
    paymentMethod: leg.paymentMethod,
    inputAmount: roundMoney(amount, 4),
    price: roundMoney(leg.price, 4),
    percentageFeeAmount: roundMoney(percentageFee, 4),
    fixedFeeAmount: roundMoney(fixedFee, 4),
    bankingFeeAmount: roundMoney(totalBankingFee, 4),
    outputAmount: roundMoney(netOutput, 4),
    effectiveRate: roundMoney(netOutput / amount, 6),
  };
}

/**
 * Evaluate risk level based on market duration and profit margin.
 */
export function evaluateTriangularRisk(
  roiPct: number,
  totalMinutes: number,
  currenciesInvolved: string[],
): { level: TriangularRiskLevel; reasons: string[] } {
  const reasons: string[] = [];

  if (roiPct <= 0) {
    reasons.push('Ruta no rentable: el margen neto no cubre costos operativos ni comisiones.');
    return { level: 'CRITICAL', reasons };
  }

  if (roiPct < 0.8) {
    reasons.push('Margen neto muy bajo (< 0.8%): alto riesgo de quedar en pérdida ante slippage o micro-fluctuaciones.');
  }

  if (totalMinutes >= 90) {
    reasons.push('Tiempo de ejecución prolongado (>= 90 min): alta exposición a volatilidad cambiaria durante la rotación.');
  } else if (totalMinutes >= 45) {
    reasons.push('Tiempo moderado de rotación (45-90 min): vigilar cambios en órdenes P2P.');
  }

  const hasHighVolatilityFiat = currenciesInvolved.includes('VES');
  if (hasHighVolatilityFiat && totalMinutes > 40 && roiPct < 1.5) {
    reasons.push('Involucra VES con rotación mayor a 40 min y margen < 1.5%: riesgo de devaluación intradiaria.');
  }

  let level: TriangularRiskLevel = 'LOW';
  if (reasons.length >= 2 || roiPct < 0.8) {
    level = 'HIGH';
  } else if (reasons.length === 1) {
    level = 'MEDIUM';
  }

  return { level, reasons };
}

/**
 * Calculate the complete 3-leg triangular arbitrage route.
 */
export function calculateTriangularArbitrage(
  routeId: string,
  routeName: string,
  initialAmount: number,
  legs: [ExchangeLeg, ExchangeLeg, ExchangeLeg],
): TriangularArbitrageResult {
  const step1 = simulateLeg(initialAmount, legs[0]);
  step1.step = 1;

  const step2 = simulateLeg(step1.outputAmount, legs[1]);
  step2.step = 2;

  const step3 = simulateLeg(step2.outputAmount, legs[2]);
  step3.step = 3;

  const finalAmount = step3.outputAmount;
  const netProfit = roundMoney(finalAmount - initialAmount, 4);
  const roiPct = initialAmount > 0 ? roundMoney((netProfit / initialAmount) * 100, 2) : 0;
  const totalDurationMinutes =
    legs[0].estimatedDurationMinutes +
    legs[1].estimatedDurationMinutes +
    legs[2].estimatedDurationMinutes;

  const currenciesInvolved = [legs[0].fromCurrency, legs[1].fromCurrency, legs[2].fromCurrency];
  const { level: riskLevel, reasons: riskReasons } = evaluateTriangularRisk(
    roiPct,
    totalDurationMinutes,
    currenciesInvolved,
  );

  // -------------------------------------------------------------
  // Breakeven price calculation for Leg 3:
  // Target: find leg3 price where finalAmount equals initialAmount
  // -------------------------------------------------------------
  const leg3 = legs[2];
  const totalFeePctLeg3 = Math.max(0, leg3.feePct) + Math.max(0, leg3.bankingFeePct ?? 0);
  const feeFactorLeg3 = Math.max(0.000001, 1 - totalFeePctLeg3 / 100);
  const totalFixedFeeLeg3 = leg3.fixedFee + (leg3.bankingFixedFee ?? 0);

  let breakevenPriceLeg3 = 0;
  let slippageTolerancePct = 0;

  if (step2.outputAmount > 0 && initialAmount > 0) {
    const targetGross = initialAmount + totalFixedFeeLeg3;
    if (leg3.isDivision) {
      breakevenPriceLeg3 = roundMoney((step2.outputAmount * feeFactorLeg3) / targetGross, 4);
      if (leg3.price > 0 && breakevenPriceLeg3 >= leg3.price) {
        slippageTolerancePct = roundMoney(((breakevenPriceLeg3 - leg3.price) / leg3.price) * 100, 2);
      }
    } else {
      breakevenPriceLeg3 = roundMoney(targetGross / (step2.outputAmount * feeFactorLeg3), 4);
      if (leg3.price > 0 && leg3.price >= breakevenPriceLeg3) {
        slippageTolerancePct = roundMoney(((leg3.price - breakevenPriceLeg3) / leg3.price) * 100, 2);
      }
    }
  }

  const projectedTurnoverHours = roundMoney(totalDurationMinutes / 60, 2);
  const hourlyRoiPct =
    projectedTurnoverHours > 0 ? roundMoney(roiPct / projectedTurnoverHours, 2) : 0;

  return {
    routeId,
    routeName,
    initialCurrency: legs[0].fromCurrency,
    initialAmount: roundMoney(initialAmount, 2),
    finalAmount: roundMoney(finalAmount, 2),
    netProfit: roundMoney(netProfit, 2),
    roiPct,
    isProfitable: netProfit > 0,
    totalDurationMinutes,
    projectedTurnoverHours,
    hourlyRoiPct,
    breakevenPriceLeg3,
    slippageTolerancePct,
    riskLevel,
    riskReasons,
    steps: [step1, step2, step3],
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Default preset routes common in Latin American P2P arbitrage.
 */
export const DEFAULT_TRIANGULAR_PRESETS: TriangularRoutePreset[] = [
  {
    id: 'route-ves-usdt-cop',
    name: 'VES ➔ USDT ➔ COP ➔ VES (Frontera / Bancolombia)',
    description: 'Comprar USDT con VES, liquidar USDT a COP en Binance P2P y retornar a VES vía mesa de cambio.',
    initialCurrency: 'VES',
    legs: [
      {
        id: 'leg-1',
        fromCurrency: 'VES',
        toCurrency: 'USDT',
        operationType: 'BUY_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Pago Móvil / Banesco',
        price: 82.5,
        isDivision: true,
        feePct: 0.35,
        fixedFee: 0,
        fixedFeeCurrency: 'USDT',
        estimatedDurationMinutes: 15,
      },
      {
        id: 'leg-2',
        fromCurrency: 'USDT',
        toCurrency: 'COP',
        operationType: 'SELL_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Bancolombia / Nequi',
        price: 4250,
        isDivision: false,
        feePct: 0.35,
        fixedFee: 0,
        fixedFeeCurrency: 'COP',
        bankingFeePct: 0.4, // 4x1000 GMF Colombia
        estimatedDurationMinutes: 15,
      },
      {
        id: 'leg-3',
        fromCurrency: 'COP',
        toCurrency: 'VES',
        operationType: 'FIAT_CONVERSION',
        platform: 'Mesa de Cambio / Giro Directo',
        paymentMethod: 'Transferencia Interbancaria',
        price: 50.8, // 1 VES = 50.8 COP => Output VES = COP / 50.8
        isDivision: true,
        feePct: 0.5,
        fixedFee: 0,
        fixedFeeCurrency: 'VES',
        estimatedDurationMinutes: 30,
      },
    ],
  },
  {
    id: 'route-usdt-usd-ves',
    name: 'USDT ➔ USD (Zinli/Wally) ➔ VES ➔ USDT (Dólar Digital)',
    description: 'Vender USDT por USD en billetera digital, pagar a tasa paralela atractiva y recomprar USDT con VES.',
    initialCurrency: 'USDT',
    legs: [
      {
        id: 'leg-1',
        fromCurrency: 'USDT',
        toCurrency: 'USD',
        operationType: 'SELL_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Zinli / Wally',
        price: 0.985, // Venta de USDT recibiendo saldo Zinli
        isDivision: false,
        feePct: 0.35,
        fixedFee: 0,
        fixedFeeCurrency: 'USD',
        bankingFixedFee: 1.0, // Retiro / transferencia Zinli
        estimatedDurationMinutes: 15,
      },
      {
        id: 'leg-2',
        fromCurrency: 'USD',
        toCurrency: 'VES',
        operationType: 'FIAT_CONVERSION',
        platform: 'P2P / Remesa Local',
        paymentMethod: 'Pago Móvil',
        price: 84.0,
        isDivision: false,
        feePct: 0.2,
        fixedFee: 0,
        fixedFeeCurrency: 'VES',
        estimatedDurationMinutes: 20,
      },
      {
        id: 'leg-3',
        fromCurrency: 'VES',
        toCurrency: 'USDT',
        operationType: 'BUY_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Banesco / Provincial',
        price: 81.8,
        isDivision: true,
        feePct: 0.35,
        fixedFee: 0,
        fixedFeeCurrency: 'USDT',
        estimatedDurationMinutes: 15,
      },
    ],
  },
];
