import { calculateSpreadTool } from './calculate_spread.js';
import { evaluateTradeRiskTool } from './evaluate_trade_risk.js';
import { simulateTradeImpactTool } from './simulate_trade_impact.js';
import { consultZkMarketMeshTool } from './consult_zk_market_mesh.js';
import { forecastVolatilityWindowTool } from './forecast_volatility_window.js';
import { calculateDeltaNeutralHedgeTool } from './calculate_delta_neutral_hedge.js';
import { triggerKillswitchTool } from './trigger_killswitch.js';
import { addOperationEntryTool } from './add_operation_entry.js';

export const ALL_MCP_TOOLS = [
  calculateSpreadTool,
  evaluateTradeRiskTool,
  simulateTradeImpactTool,
  consultZkMarketMeshTool,
  forecastVolatilityWindowTool,
  calculateDeltaNeutralHedgeTool,
  triggerKillswitchTool,
  addOperationEntryTool,
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
};
