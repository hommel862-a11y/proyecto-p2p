/**
 * Ledger Resources — Operaciones, PnL, disputas e historial.
 */

export interface LedgerResource {
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

// ─── Recent Operations ────────────────────────────────────────────────────────

export const recentLedgerResource: LedgerResource = {
  name: 'recent-operations',
  uri: 'p2p://ledger/recent',
  title: 'Recent Operations',
  description: 'Últimas 20 operaciones registradas en el ledger P2P',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_ledger',
    timestamp: Date.now(),
    operations: await ipcCall('p2p:db-list-operations', { limit: 20 }),
  }),
};

// ─── PnL Summary ──────────────────────────────────────────────────────────────

export const pnlSummaryResource: LedgerResource = {
  name: 'pnl-summary',
  uri: 'p2p://ledger/pnl',
  title: 'PnL Summary',
  description: 'Resumen de ganancias y pérdidas (7d, 30d, total)',
  mimeType: 'application/json',
  read: async () => ({
    source: 'pnl_engine',
    timestamp: Date.now(),
    summary: await ipcCall('p2p:pnl-summary', { period: '7d' }),
  }),
};

// ─── Bank Events ──────────────────────────────────────────────────────────────

export const bankEventsResource: LedgerResource = {
  name: 'bank-events',
  uri: 'p2p://ledger/bank-events',
  title: 'Bank Events',
  description: 'Eventos bancarios recientes (transferencias, recibos, reversiones)',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_ledger',
    timestamp: Date.now(),
    events: await ipcCall('p2p:db-list-bank-events', { limit: 50 }),
  }),
};

// ─── Disputes ─────────────────────────────────────────────────────────────────

export const disputesResource: LedgerResource = {
  name: 'disputes',
  uri: 'p2p://ledger/disputes',
  title: 'Active Disputes',
  description: 'Disputas activas con Binance y estado de evidencia',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_ledger',
    timestamp: Date.now(),
    disputes: await ipcCall('p2p:db-list-disputes', { status: 'OPEN' }),
  }),
};

// ─── Ledger Export ────────────────────────────────────────────────────────────

export const exportResource: LedgerResource = {
  name: 'ledger-export',
  uri: 'p2p://ledger/export',
  title: 'Ledger CSV Export',
  description: 'Exportación del ledger completo en formato CSV',
  mimeType: 'application/json',
  read: async () => ({
    source: 'p2p_ledger',
    timestamp: Date.now(),
    export: await ipcCall('p2p:db-export-ledger', { format: 'csv' }),
  }),
};

// ─── Agregación ───────────────────────────────────────────────────────────────

export const ledgerResources: LedgerResource[] = [
  recentLedgerResource,
  pnlSummaryResource,
  bankEventsResource,
  disputesResource,
  exportResource,
];
