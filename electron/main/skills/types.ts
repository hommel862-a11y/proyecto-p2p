/**
 * Financial Agent Skills for Gemini Orchestrator.
 * Contract types, parameter schemas and shared parsing utilities.
 */

import type { BankType } from '../vendor/p2p-core/receipt-ocr';

export interface AgentSkillParameterSchema {
  type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  description: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, AgentSkillParameterSchema>;
  required?: string[];
}

export interface AgentSkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, AgentSkillParameterSchema>;
    required: string[];
  };
}

export interface FinancialSkillResult {
  success: boolean;
  skillName: string;
  data?: unknown;
  error?: string;
  executedAt: number;
}

/**
 * Normaliza el nombre de banco recibido a los valores de `BankType` del dominio
 * (recepción de comprobantes). Mapeo de datos, no lógica de cálculo.
 */
export function normalizeBankToType(bankName: string): BankType {
  const norm = (bankName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (norm.includes('BANESCO')) return 'BANESCO';
  if (norm.includes('MERCANTIL')) return 'MERCANTIL';
  if (norm.includes('BANCODEVENEZUELA') || norm.includes('BDV')) return 'BDV';
  if (norm.includes('PROVINCIAL')) return 'PROVINCIAL';
  if (norm.includes('BANCAMIGA')) return 'BANCAMIGA';
  if (norm.includes('BANCOLOMBIA')) return 'BANCOLOMBIA';
  if (norm.includes('NEQUI')) return 'NEQUI';
  if (norm.includes('ZINLI')) return 'ZINLI';
  if (norm.includes('ELDORADO') || norm.includes('DORADO')) return 'EL_DORADO';
  return 'UNKNOWN';
}
