/**
 * Resources Index — Agrega todos los resources MCP.
 */

import { marketResources } from './market.js';
import { ledgerResources } from './ledger.js';
import { riskResources } from './risk.js';

export const ALL_MCP_RESOURCES = [
  ...marketResources,
  ...ledgerResources,
  ...riskResources,
];

export {
  marketResources,
  ledgerResources,
  riskResources,
};