import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import {
  WsBridge,
  createWsBridge,
  formatReceiptForWs,
  type WsBridgeConfig,
  type WsMessage,
  type WsChatEvent,
  type WsConnectionStatus,
} from './ws-bridge';

// Mock WebSocket global
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sentMessages: any[] = [];

  constructor(url: string) {
    this.url = url;
    // Simular conexión asíncrona
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent('close', { code: code || 1000, reason: reason || '', wasClean: true }),
    );
  }

  // Helpers para testing
  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateError(): void {
    this.onerror?.(new Event('error'));
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason, wasClean: true }));
  }
}

// Reemplazar WebSocket global para tests
const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = MockWebSocket as any;

describe('ws-bridge', () => {
  let bridge: WsBridge;
  const mockConfig: Partial<WsBridgeConfig> = {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    userId: 'test-user',
    autoReconnect: false, // Deshabilitar para tests unitarios
    reconnectInterval: 100,
    maxReconnectAttempts: 3,
    heartbeatInterval: 1000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new WsBridge(mockConfig);
  });

  afterEach(() => {
    bridge.disconnect();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('createWsBridge', () => {
    it('crea instancia con configuración por defecto', () => {
      const ws = createWsBridge();
      expect(ws).toBeInstanceOf(WsBridge);
      ws.disconnect();
    });

    it('crea instancia con configuración personalizada', () => {
      const ws = createWsBridge({ apiKey: 'custom', userId: 'custom-user' });
      expect(ws).toBeInstanceOf(WsBridge);
      ws.disconnect();
    });
  });

  describe('connection lifecycle', () => {
    it('inicia en estado disconnected', () => {
      expect(bridge.getStatus()).toBe('disconnected');
    });

    it('conecta y cambia estado a connected', async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(20);
      await connectPromise;

      expect(bridge.getStatus()).toBe('connected');
      expect(bridge.isReady()).toBe(false); // No autenticado aún
    });

    it('desconecta limpiamente', async () => {
      await bridge.connect();
      await vi.advanceTimersByTimeAsync(20);

      bridge.disconnect();

      expect(bridge.getStatus()).toBe('disconnected');
      expect(bridge.isReady()).toBe(false);
    });
  });

  describe('message handling', () => {
    it('encola mensajes cuando no está conectado', async () => {
      const msgId = await bridge.sendMessage({
        type: 'text',
        content: 'Hola',
      });

      expect(msgId).toMatch(/^msg_\d+_/);
      // Mensaje encolado, no enviado aún
    });

    it('envía mensajes cuando conectado y autenticado', async () => {
      await bridge.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Simular autenticación exitosa
      const ws = (bridge as any).ws as MockWebSocket;
      ws.simulateMessage({ type: 'auth', success: true });

      await vi.advanceTimersByTimeAsync(10);

      const msgId = await bridge.sendMessage({
        type: 'text',
        content: 'Test message',
      });

      expect(msgId).toMatch(/^msg_\d+_/);
      // Verificar que se envió
      expect(ws.sentMessages.length).toBeGreaterThan(1); // auth + message
    });

    it('envía comprobantes con metadatos correctos', async () => {
      await bridge.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (bridge as any).ws as MockWebSocket;
      ws.simulateMessage({ type: 'auth', success: true });
      await vi.advanceTimersByTimeAsync(10);

      await bridge.sendReceipt('ORDER-123', 'base64-receipt-data', 'image');

      // Buscar mensaje de tipo receipt
      const receiptMsg = ws.sentMessages.find(
        (m: any) => m.type === 'receipt' && m.metadata?.orderId === 'ORDER-123',
      );
      expect(receiptMsg).toBeDefined();
      expect(receiptMsg.metadata.receiptType).toBe('image');
    });
  });

  describe('event handlers', () => {
    it('registra y ejecuta handlers', async () => {
      const handler = vi.fn();
      const cleanup = bridge.on('message_received', handler);

      await bridge.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (bridge as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: 'auth',
        success: true,
      });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        eventType: 'message_received',
        payload: { text: 'Hello' },
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'message_received',
          payload: { text: 'Hello' },
        }),
      );

      // Cleanup
      cleanup();
    });

    it('cleanup elimina handler correctamente', async () => {
      const handler = vi.fn();
      const cleanup = bridge.on('message_received', handler);

      await bridge.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (bridge as any).ws as MockWebSocket;
      ws.simulateMessage({ type: 'auth', success: true });
      await vi.advanceTimersByTimeAsync(10);

      cleanup();

      ws.simulateMessage({
        eventType: 'message_received',
        payload: { text: 'After cleanup' },
        timestamp: new Date().toISOString(),
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('formatReceiptForWs', () => {
    it('formatea comprobante con todos los campos', () => {
      const receipt = formatReceiptForWs('ORDER-456', 50000, 'Banesco', 'REF-789', 'Juan Pérez');

      const parsed = JSON.parse(receipt);

      expect(parsed.orderId).toBe('ORDER-456');
      expect(parsed.amount).toBe(50000);
      expect(parsed.bank).toBe('Banesco');
      expect(parsed.reference).toBe('REF-789');
      expect(parsed.senderName).toBe('Juan Pérez');
      expect(parsed.type).toBe('pago_movil');
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('reconnection logic', () => {
    it('programa reconexión al cerrar conexión', async () => {
      mockConfig.autoReconnect = true;
      const ws = new WsBridge(mockConfig);

      await ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const wsInstance = (ws as any).ws as MockWebSocket;
      wsInstance.simulateClose(1006, 'Abnormal closure');

      // Debe estar en reconnecting
      expect(ws.getStatus()).toBe('reconnecting');

      // Avanzar tiempo de reconexión
      await vi.advanceTimersByTimeAsync(200);

      ws.disconnect();
    });
  });
});

afterAll(() => {
  globalThis.WebSocket = originalWebSocket;
});
