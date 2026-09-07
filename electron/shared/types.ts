// Typed IPC contract for the P2P Decision Tool Electron shell (design #301, D3).
// The renderer may ONLY invoke these allow-listed channels through the preload bridge.
// All domain math stays in @p2p/core and runs inside the web bundle — NOT over IPC.

export interface BinanceSearchParams {
  asset: string;
  fiat: string;
  tradeType: 'BUY' | 'SELL';
  payTypes?: string[];
  rows?: number;
}

export interface CotizaveRequest {
  apiKey: string;
  endpoint: 'rates';
}

export interface P2PIpcChannels {
  'app:get-version': {
    request: void;
    response: string;
  };
  'p2p:fetch-binance': {
    request: BinanceSearchParams;
    response: unknown;
  };
  'p2p:fetch-cotizave': {
    request: CotizaveRequest;
    response: unknown;
  };
  'crypto:is-available': {
    request: void;
    response: boolean;
  };
  'crypto:encrypt': {
    request: string;
    response: string;
  };
  'crypto:decrypt': {
    request: string;
    response: string;
  };
}

// The narrow, typed surface the preload exposes on `window.electron`.
export interface ElectronAPI {
  getVersion(): Promise<string>;
  fetchBinanceP2p(params: BinanceSearchParams): Promise<unknown>;
  fetchCotizave(req: CotizaveRequest): Promise<unknown>;
  crypto: {
    isAvailable(): Promise<boolean>;
    encrypt(plaintext: string): Promise<string>;
    decrypt(ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
