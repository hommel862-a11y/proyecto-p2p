import { calculateSpreadTool } from './calculate_spread.js';
import { evaluateTradeRiskTool } from './evaluate_trade_risk.js';
import { simulateTradeImpactTool } from './simulate_trade_impact.js';
import { consultZkMarketMeshTool } from './consult_zk_market_mesh.js';
import { forecastVolatilityWindowTool } from './forecast_volatility_window.js';
import { calculateDeltaNeutralHedgeTool } from './calculate_delta_neutral_hedge.js';
import { triggerKillswitchTool } from './trigger_killswitch.js';
import { addOperationEntryTool } from './add_operation_entry.js';
// Phase 2: Venezuelan Rates & BCV Monitoring
import { getBcvRatesTool } from './get_bcv_rates.js';
import { getParallelRatesTool } from './get_parallel_rates.js';
import { calculateRateGapTool } from './calculate_rate_gap.js';
import { checkBcvInterventionWindowTool } from './check_bcv_intervention_window.js';
import { autofillTradeReferenceTool } from './autofill_trade_reference.js';
// Phase 3: Crypto Market Data & Microstructure
import { getBinanceP2POrderbookTool } from './get_binance_p2p_orderbook.js';
import { detectUsdtDepegTool } from './detect_usdt_depeg.js';
import { recommendCompetitivePricingTool } from './recommend_competitive_pricing.js';
import { analyzeOrderbookPressureTool } from './analyze_orderbook_pressure.js';
// Phase 4: Portfolio Management & Risk Stress Testing
import { stressTestPortfolioTool } from './stress_test_portfolio.js';
import { rebalanceCapitalAllocationTool } from './rebalance_capital_allocation.js';
import { auditCounterpartyExposureTool } from './audit_counterparty_exposure.js';
import { projectCompoundRunwayTool } from './project_compound_runway.js';

export const ALL_MCP_TOOLS = [
  calculateSpreadTool,
  evaluateTradeRiskTool,
  simulateTradeImpactTool,
  consultZkMarketMeshTool,
  forecastVolatilityWindowTool,
  calculateDeltaNeutralHedgeTool,
  triggerKillswitchTool,
  addOperationEntryTool,
  // Phase 2
  getBcvRatesTool,
  getParallelRatesTool,
  calculateRateGapTool,
  checkBcvInterventionWindowTool,
  autofillTradeReferenceTool,
  // Phase 3
  getBinanceP2POrderbookTool,
  detectUsdtDepegTool,
  recommendCompetitivePricingTool,
  analyzeOrderbookPressureTool,
  // Phase 4
  stressTestPortfolioTool,
  rebalanceCapitalAllocationTool,
  auditCounterpartyExposureTool,
  projectCompoundRunwayTool,
];

export {
  calculateSpreadTool,
  evaluateTradeRiskTool,
  simulateTradeImpactTool,
  consultZkMarketMeshTool,
  forecastVolatilityWindowTool,
  calculateDeltaNeutralHedgeTool,
  triggerKillswitchTool,
  addOperationEntryTool,
  // Phase 2
  getBcvRatesTool,
  getParallelRatesTool,
  calculateRateGapTool,
  checkBcvInterventionWindowTool,
  autofillTradeReferenceTool,
  // Phase 3
  getBinanceP2POrderbookTool,
  detectUsdtDepegTool,
  recommendCompetitivePricingTool,
  analyzeOrderbookPressureTool,
  // Phase 4
  stressTestPortfolioTool,
  rebalanceCapitalAllocationTool,
  auditCounterpartyExposureTool,
  projectCompoundRunwayTool,
};



