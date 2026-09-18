/**
 * Risk Resources — Estado de riesgo, reglas, veredictos, alertas y simulaciones.
 */

export interface RiskResource {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: 'application/json';
  read: () => Promise<Record<string, unknown>>;
}

async function ipcCall(channel: string, args: unknown): Promise<Record<string, unknown>> {
  try {
    const result = await globalThis.mcp?.callTool?.('electron_ipc_invoke', {
      channel,
      args: [args],
    });
    return (
      (result?.data as Record<string, unknown>) ?? {
        error: result?.error ?? `${channel} unavailable`,
      }
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'IPC bridge error' };
  }
}

// ─── Live Risk Status ─────────────────────────────────────────────────────────

export const liveRiskResource: RiskResource = {
  name: 'live-risk-status',
  uri: 'p2p://risk/live-status',
  title: 'Live Risk Status',
  description: 'Estado de riesgo actual: exposición, racha, win rate y verdicto en tiempo real',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    status: await ipcCall('p2p:risk-status', {}),
  }),
};

// ─── Risk Rules ───────────────────────────────────────────────────────────────

export const riskRulesResource: RiskResource = {
  name: 'risk-rules',
  uri: 'p2p://risk/rules',
  title: 'Risk Rules Configuration',
  description: 'Configuración actual de las 6 reglas deterministas de riesgo con umbrales',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    rules: await ipcCall('p2p:get-risk-rules', {}),
  }),
};

// ─── Recent Verdicts ──────────────────────────────────────────────────────────

export const verdictsResource: RiskResource = {
  name: 'risk-verdicts',
  uri: 'p2p://risk/verdicts',
  title: 'Recent Risk Verdicts',
  description: 'Últimos veredictos emitidos por el motor de riesgo con razones',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    verdicts: await ipcCall('p2p:db-list-verdicts', { limit: 50 }),
  }),
};

// ─── Active Alerts ────────────────────────────────────────────────────────────

export const alertsResource: RiskResource = {
  name: 'risk-alerts',
  uri: 'p2p://risk/alerts',
  title: 'Active Risk Alerts',
  description: 'Alertas activas de riesgo (CRITICAL, WARNING, SUGGESTION)',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    alerts: await ipcCall('p2p:risk-active-alerts', { includeResolved: false }),
  }),
};

// ─── Counterparty Profile ─────────────────────────────────────────────────────

export const counterpartyResource: RiskResource = {
  name: 'counterparty-profile',
  uri: 'p2p://risk/counterparty/{id}',
  title: 'Counterparty Risk Profile',
  description:
    'Perfil de riesgo de una contraparte específica: historial, dispute rate, trust score',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    message:
      'Este recurso requiere un ID de contraparte. Use la tool evaluate_trade_risk con counterpartyScore.',
  }),
};

// ─── Trade Simulation ─────────────────────────────────────────────────────────

export const simulationResource: RiskResource = {
  name: 'trade-simulation',
  uri: 'p2p://risk/simulation',
  title: 'Trade Impact Simulation',
  description: 'Simulación de impacto de trade en exposición acumulada con proyecciones',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_risk_engine',
    timestamp: Date.now(),
    simulation: await ipcCall('p2p:risk-simulation', { scenario: 'default' }),
  }),
};

// ─── Agregación ───────────────────────────────────────────────────────────────

export const riskResources: RiskResource[] = [
  liveRiskResource,
  riskRulesResource,
  verdictsResource,
  alertsResource,
  counterpartyResource,
  simulationResource,
];
