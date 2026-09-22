/**
 * Hedge Calculator & Currency Devaluation Simulator
 * Herramienta interna de cálculo de riesgo cambiario para operaciones P2P VES/USD.
 * Proyecto: P2P Decisor - Nivel Avanzado
 * 
 * Funcionalidad:
 - Proyecta cómo la fluctuación del tipo de cambio VES/USD impacta el inventario libre de USDT
 - Calcula el USDT necesario para cobertura total/parcial
 - Escenarios: conservador, moderado, agresivo
 - APR real considerando comisiones y spreads
 */

export interface HedgeConfig {
  usdtAmount: number; // USDT actual en inventario
  vesPerUsdCurrent: number; // Tipo de cambio VES/USD actual
  vesPerUsdMin: number; // Tipo de cambio mínimo tolerado (peor caso)
  vesPerUsdMax: number; // Tipo de cambio máximo tolerado (mejor caso)
  coveragePct: number; // Porcentaje de cobertura objetivo (0-100)
  usdtFeeRate: number; // Tarifa de comisión en USDT (porcentaje)
  usdtPerVesFee: number; // VES por cada USDT de comisión
}

/**
 * Escenario de cobertura simulada
 */
export interface HedgeScenario {
  name: string;
  coveragePct: number;
  usdtNeeded: number; // USDT necesario para el porcentaje de cobertura
  vesAtRisk: number; // VES en riesgo si el tipo cambia
  breakEvenVesPerUsd: number; // Punto de equilibrio
  profitLossVes: number; // PnL proyectado en VES
}

/**
 * Calcula los escenarios de hedge necesarios para cubrir el inventario
 * @param config Configuración actual del inventario
 * @returns Escenarios de cobertura para diferentes estrategias
 */
export function calculateHedgeScenarios(config: HedgeConfig): HedgeScenario[] {
  const { usdtAmount, vesPerUsdCurrent, vesPerUsdMin, vesPerUsdMax, coveragePct } = config;

  // USDT objetivo para cobertura deseada al tipo actual
  const usdtTarget = (usdtAmount * coveragePct) / 100;

  // ESCENARIO 1: Conservador - Cobertura total al peor tipo (vesPerUsdMin)
  // Si el tipo baja a min, cada USDT vale menos VES. Para mantener valor VES, necesitamos más USDT.
  const usdtNeededConservative = Math.round((usdtAmount * vesPerUsdCurrent) / vesPerUsdMin);
  const vesAtRiskConservative = Math.round((usdtNeededConservative - usdtAmount) * vesPerUsdMin);
  const breakEvenConservative = vesPerUsdMin;
  // PnL si el tipo se mueve a min: perdemos valor en VES
  const profitLossConservative = Math.round((vesPerUsdMin - vesPerUsdCurrent) * usdtAmount);

  // ESCENARIO 2: Moderado - Cobertura objetivo al tipo actual
  const usdtNeededModerate = Math.round(usdtTarget);
  const vesAtRiskModerate = Math.round((usdtNeededModerate - usdtAmount) * vesPerUsdCurrent);
  const breakEvenModerate = vesPerUsdCurrent;
  const profitLossModerate = 0; // En tipo actual, break-even

  // ESCENARIO 3: Agresivo - Cobertura parcial, mantener liquidez
  // Intentamos cobertura objetivo + 20% pero máximo 100%
  const coverageAggressive = Math.min(coveragePct + 20, 100);
  const usdtNeededAggressive = Math.round((usdtAmount * coverageAggressive) / 100);
  const vesAtRiskAggressive = Math.round((usdtNeededAggressive - usdtAmount) * vesPerUsdCurrent);
  const breakEvenAggressive = vesPerUsdCurrent;
  // PnL si tipo va a max (mejor caso): ganancia
  const profitLossAggressive = Math.round((vesPerUsdMax - vesPerUsdCurrent) * usdtAmount);

  return [
    {
      name: 'Conservador',
      coveragePct: 100,
      usdtNeeded: usdtNeededConservative,
      vesAtRisk: vesAtRiskConservative,
      breakEvenVesPerUsd: breakEvenConservative,
      profitLossVes: profitLossConservative,
    },
    {
      name: 'Moderado',
      coveragePct,
      usdtNeeded: usdtNeededModerate,
      vesAtRisk: vesAtRiskModerate,
      breakEvenVesPerUsd: breakEvenModerate,
      profitLossVes: profitLossModerate,
    },
    {
      name: 'Agresivo',
      coveragePct: coverageAggressive,
      usdtNeeded: usdtNeededAggressive,
      vesAtRisk: vesAtRiskAggressive,
      breakEvenVesPerUsd: breakEvenAggressive,
      profitLossVes: profitLossAggressive,
    },
  ];
}

/**
 * Simula la devaluación: qué pasa con el inventario si el tipo cambia
 * @param config Configuración actual
 * @param newVesPerUsd Nuevo tipo de cambio simulado
 * @returns Impacto en el inventario
 */
export function simulateDevaluation(
  config: HedgeConfig,
  newVesPerUsd: number,
): {
  usdtRemaining: number;
  vesValueAtNewRate: number;
  percentageLoss: number;
  shouldHedge: boolean;
} {
  const { usdtAmount, vesPerUsdCurrent } = config;

  // Valor al nuevo tipo
  const vesValueAtNewRate = usdtAmount * newVesPerUsd;

  // Cambio porcentual (positivo = ganancia, negativo = pérdida)
  const percentageChange =
    vesPerUsdCurrent > 0 ? Math.round((newVesPerUsd / vesPerUsdCurrent - 1) * 100) : 0;

  // percentageLoss: negativo = pérdida, positivo = ganancia
  const percentageLoss = percentageChange;

  // Recomendación: hacer hedge si hay PÉRDIDA (percentageLoss < 0) y excede 15%
  const shouldHedge = percentageLoss < -15;

  return {
    usdtRemaining: usdtAmount,
    vesValueAtNewRate: Math.round(vesValueAtNewRate),
    percentageLoss,
    shouldHedge,
  };
}

/**
 * Obtiene la recomendación de hedging basada en la configuración
 * @param config Configuración del inventario
 * @returns Recomendación con acción sugerida
 */
export function getHedgeRecommendation(config: HedgeConfig): {
  action: 'NO_ACTION' | 'PARTIAL_HEDGE' | 'FULL_HEDGE';
  reason: string;
  usdtToHedge: number;
  expectedSavingsVes: number;
} {
  const { usdtAmount, vesPerUsdCurrent, vesPerUsdMax, coveragePct } = config;

  // Si el tipo actual ya es el máximo tolerado, no hacer hedge
  if (vesPerUsdCurrent >= vesPerUsdMax) {
    return {
      action: 'NO_ACTION',
      reason: 'Tipo de cambio ya en límite máximo tolerado',
      usdtToHedge: 0,
      expectedSavingsVes: 0,
    };
  }

  // coveragePct = cobertura ACTUAL (% del inventario ya hedgeado)
  // Si cobertura actual < 80%, recomendar hedge para llegar al 80%
  if (coveragePct < 80) {
    // USDT objetivo para 80% de cobertura
    const usdtTarget = (usdtAmount * 80) / 100;
    // USDT ya hedgeado
    const usdtHedged = (usdtAmount * coveragePct) / 100;
    // USDT adicional necesario
    const usdtToHedge = Math.max(0, usdtTarget - usdtHedged);

    return {
      action: 'PARTIAL_HEDGE',
      reason: `Cobertura actual ${coveragePct}% < 80%. Se recomienda hedge de ${Math.round(usdtToHedge)} USDT para alcanzar mínimo 80%`,
      usdtToHedge: Math.round(usdtToHedge),
      expectedSavingsVes: Math.round((vesPerUsdMax - vesPerUsdCurrent) * usdtToHedge),
    };
  }

  // Verificar escenarios de pérdida si el tipo cambia agresivamente al máximo tolerado
  const devalSimulation = simulateDevaluation(config, vesPerUsdMax);

  if (devalSimulation.percentageLoss < -20) {
    // Si moverse al max implicaría pérdida > 20%, hedge completo
    return {
      action: 'FULL_HEDGE',
      reason: `Alta volatilidad: simulación a ${vesPerUsdMax} Bs/USDT muestra pérdida del ${Math.abs(devalSimulation.percentageLoss)}%. Cobertura total recomendada`,
      usdtToHedge: usdtAmount,
      expectedSavingsVes: Math.round((vesPerUsdMax - vesPerUsdCurrent) * usdtAmount),
    };
  }

  // Caso medio: mantener cobertura actual, monitorear
  return {
    action: 'NO_ACTION',
    reason: `Cobertura actual ${coveragePct}% aceptable. Monitorear tipos de cambio.`,
    usdtToHedge: 0,
    expectedSavingsVes: 0,
  };
}
