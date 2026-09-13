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

export type P2POrderState =
  | 'ORDER_DETECTED'
  | 'PAYMENT_PENDING'
  | 'BANK_EVENT_RECEIVED'
  | 'IDENTITY_VERIFIED'
  | 'SUSPECTED_TRIANGULATION'
  | 'AWAITING_RELEASE'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface InboundBankDetails {
  bank: string;
  reference: string;
  payerName?: string;
  payerIdDoc?: string;
  amountFiat: number;
  timestamp: number;
}

export interface FsmAuditRecord {
  fromState: P2POrderState;
  toState: P2POrderState;
  event: string;
  timestamp: number;
  reason?: string;
}

export interface FsmOrderContext {
  orderId: string;
  side: 'BUY' | 'SELL';
  asset: string;
  fiat: string;
  amountCrypto: number;
  amountFiat: number;
  price: number;
  counterpartyName: string;
  counterpartyIdDoc?: string;
  currentState: P2POrderState;
  bankPayment?: InboundBankDetails;
  fraudScore?: number;
  flags: string[];
  history: FsmAuditRecord[];
  createdAt: number;
  updatedAt: number;
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
  'p2p:db-save-order': {
    request: unknown;
    response: boolean;
  };
  'p2p:db-get-order': {
    request: string;
    response: unknown;
  };
  'p2p:db-list-active-orders': {
    request: void;
    response: unknown[];
  };
  'p2p:db-record-bank-event': {
    request: unknown;
    response: { isDuplicate: boolean; eventId: number };
  };
  'p2p:killswitch-trigger': {
    request: { reason?: string; source?: string };
    response: boolean;
  };
  'p2p:killswitch-status': {
    request: void;
    response: { isTriggered: boolean; timestamp?: number; reason?: string; source?: string };
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
  db: {
    saveOrder(order: unknown): Promise<boolean>;
    getOrder(orderId: string): Promise<unknown>;
    listActiveOrders(): Promise<unknown[]>;
    recordBankEvent(event: unknown): Promise<{ isDuplicate: boolean; eventId: number }>;
  };
  killswitch: {
    trigger(params?: { reason?: string; source?: string }): Promise<boolean>;
    getStatus(): Promise<{ isTriggered: boolean; timestamp?: number; reason?: string; source?: string }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
