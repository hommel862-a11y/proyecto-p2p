/**
 * Resources Index — Agrega todos los resources MCP.
 */

import { marketResources } from './market.js';
import { ledgerResources } from './ledger.js';
import { riskResources } from './risk.js';
import { ratesResources } from './rates.js';
import { cryptoResources } from './crypto.js';
import { portfolioResources } from './portfolio.js';

export const ALL_MCP_RESOURCES = [
  ...marketResources,
  ...ledgerResources,
  ...riskResources,
  ...ratesResources,
  ...cryptoResources,
  ...portfolioResources,
];

export {
  marketResources,
  ledgerResources,
  riskResources,
  ratesResources,
  cryptoResources,
  portfolioResources,
};
