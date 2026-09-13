/**
 * Market Resources — Datos de mercado en tiempo real e histórico.
 */

export interface MarketResource {
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
    return (result?.data as Record<string, unknown>) ?? { error: result?.error ?? `${channel} unavailable` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'IPC bridge error' };
  }
}

// ─── Binance P2P Orderbook ────────────────────────────────────────────────────

export const binanceOrderbookResource: MarketResource = {
  name: 'binance-p2p-orderbook',
  uri: 'p2p://market/binance/orderbook',
  title: 'Binance P2P Orderbook',
  description: 'Últimas ofertas del orderbook Binance P2P USDT/VES (SELL) en tiempo real',
  mimeType: 'application/json',
  read: async () => ({
    source: 'binance_p2p',
    asset: 'USDT',
    fiat: 'VES',
    tradeType: 'SELL',
    timestamp: Date.now(),
    offers: await ipcCall('p2p:fetch-binance', {
      asset: 'USDT', fiat: 'VES', tradeType: 'SELL', payTypes: [], rows: 20,
    }),
  }),
};

// ─── Cotizave Rates ───────────────────────────────────────────────────────────

export const cotizaveRatesResource: MarketResource = {
  name: 'cotizave-rates',
  uri: 'p2p://market/cotizave/rates',
  title: 'Cotizave Rates',
  description: 'Tipo de cambio USD/VES y EUR/VES desde Cotizave API',
  mimeType: 'application/json',
  read: async () => ({
    source: 'cotizave',
    timestamp: Date.now(),
    rates: await ipcCall('p2p:fetch-cotizave', {
      endpoint: 'rates',
      apiKey: process.env.COTIZAVE_API_KEY,
    }),
  }),
};

// ─── Spread History ───────────────────────────────────────────────────────────

export const spreadHistoryResource: MarketResource = {
  name: 'spread-history',
  uri: 'p2p://market/spread/history',
  title: 'Spread History',
  description: 'Historial de spreads Binance P2P USDT/VES en ventana configurable',
  mimeType: 'application/json',
  read: async () => ({
    source: 'spread_engine',
    asset: 'USDT',
    fiat: 'VES',
    window: '1d',
    timestamp: Date.now(),
    history: await ipcCall('p2p:spread-history', {
      asset: 'USDT', fiat: 'VES', window: '1d', limit: 200,
    }),
  }),
};

// ─── BCV History ──────────────────────────────────────────────────────────────

export const bcvHistoryResource: MarketResource = {
  name: 'bcv-history',
  uri: 'p2p://market/bcv/history',
  title: 'BCV History & Predictor',
  description: 'Histórico de tasa BCV y predicción de ventana de intervención',
  mimeType: 'application/json',
  read: async () => ({
    source: 'bcv_predictor',
    timestamp: Date.now(),
    data: await ipcCall('p2p:bcv-history', {
      days: 30, includePrediction: true,
    }),
  }),
};

// ─── Bank Liquidity ───────────────────────────────────────────────────────────

export const bankLiquidityResource: MarketResource = {
  name: 'bank-liquidity',
  uri: 'p2p://market/bank/liquidity',
  title: 'Bank Liquidity Profile',
  description: 'Profundidad de liquidez por banco para USDT/VES en ventana horaria',
  mimeType: 'application/json',
  read: async () => ({
    source: 'johnson_depth',
    asset: 'USDT',
    fiat: 'VES',
    windowHours: 24,
    timestamp: Date.now(),
    liquidity: await ipcCall('p2p:bank-liquidity', {
      asset: 'USDT', fiat: 'VES', windowHours: 24,
    }),
  }),
};

// ─── ZK Mesh Stats ────────────────────────────────────────────────────────────

export const zkMeshStatsResource: MarketResource = {
  name: 'zk-mesh-stats',
  uri: 'p2p://market/zk-mesh',
  title: 'ZK Mesh Statistics',
  description: 'Estadísticas de la red federada de identificadores fichados (zero-knowledge)',
  mimeType: 'application/json',
  read: async () => ({
    source: 'zk_mesh',
    timestamp: Date.now(),
    mesh: await ipcCall('p2p:zk-mesh-stats', { scope: 'global' }),
  }),
};

// ─── Agregación ───────────────────────────────────────────────────────────────

export const marketResources: MarketResource[] = [
  binanceOrderbookResource,
  cotizaveRatesResource,
  spreadHistoryResource,
  bcvHistoryResource,
  bankLiquidityResource,
  zkMeshStatsResource,
];