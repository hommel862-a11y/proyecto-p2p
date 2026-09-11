/**
 * WebSocket Bridge para Binance P2P Chat y Comprobantes
 * Proyecto: P2P Decisor - Nivel Avanzado
 * 
 * Funcionalidad:
 - Conexión WebSocket al chat de Binance P2P
 - Envío automatizado de mensajes y comprobantes de pago
 - Recepción de eventos: nuevos mensajes, confirmaciones, disputas
 - Reconexión automática con backoff exponencial
 - Tipado estricto para eventos de chat
 */

export interface WsBridgeConfig {
  apiKey: string;
  apiSecret: string;
  userId: string;
  autoReconnect: boolean;
  reconnectInterval: number; // ms
  maxReconnectAttempts: number;
  heartbeatInterval: number; // ms
}

export interface WsMessage {
  type: 'text' | 'image' | 'receipt' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  messageId: string;
}

export interface WsChatEvent {
  eventType: 'message_received' | 'message_sent' | 'order_update' | 'dispute_created' | 'payment_confirmed' | 'connection_status';
  payload: unknown;
  timestamp: string;
}

export type WsEventHandler = (event: WsChatEvent) => void;

export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

/**
 * Cliente WebSocket para Binance P2P Chat
 * Maneja conexión, reconexión, heartbeat y eventos
 */
export class WsBridge {
  private ws: WebSocket | null = null;
  private config: WsBridgeConfig;
  private handlers: Map<string, WsEventHandler[]> = new Map();
  private status: WsConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: WsMessage[] = [];
  private isAuthenticated = false;

  constructor(config: Partial<WsBridgeConfig> = {}) {
    this.config = {
      apiKey: config.apiKey || '',
      apiSecret: config.apiSecret || '',
      userId: config.userId || '',
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };
  }

  /**
   * Establece conexión WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setStatus('connecting');

    try {
      // En producción, la URL sería wss://stream.binance.com:9443/ws/...
      // Para testing usamos una URL mock
      const wsUrl = `wss://stream.binance.com:9443/ws/${this.config.userId}@p2pChat`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => this.handleOpen();
      this.ws.onclose = (e) => this.handleClose(e);
      this.ws.onerror = (e) => this.handleError(e);
      this.ws.onmessage = (e) => this.handleMessage(e);
      
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * Desconecta limpiamente
   */
  disconnect(): void {
    this.config.autoReconnect = false;
    this.clearTimers();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.setStatus('disconnected');
    this.isAuthenticated = false;
  }

  /**
   * Envía un mensaje de chat
   */
  async sendMessage(message: Omit<WsMessage, 'timestamp' | 'messageId'>): Promise<string> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const wsMessage: WsMessage = {
      ...message,
      timestamp: new Date().toISOString(),
      messageId,
    };

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      this.sendRaw(wsMessage);
    } else {
      // Encolar para enviar cuando se conecte
      this.messageQueue.push(wsMessage);
    }

    return messageId;
  }

  /**
   * Envía un comprobante de pago (imagen/archivo)
   */
  async sendReceipt(orderId: string, receiptData: string, type: 'image' | 'file' = 'image'): Promise<string> {
    return this.sendMessage({
      type: 'receipt',
      content: receiptData,
      metadata: { orderId, receiptType: type },
    });
  }

  /**
   * Registra un handler para eventos
   */
  on(eventType: string, handler: WsEventHandler): () => void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);

    // Retornar función de cleanup
    return () => {
      const h = this.handlers.get(eventType) || [];
      const idx = h.indexOf(handler);
      if (idx >= 0) h.splice(idx, 1);
    };
  }

  /**
   * Obtiene estado actual de conexión
   */
  getStatus(): WsConnectionStatus {
    return this.status;
  }

  /**
   * Verifica si está conectado y autenticado
   */
  isReady(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  // --- Private methods ---

  private handleOpen(): void {
    this.setStatus('connected');
    this.reconnectAttempts = 0;
    this.startHeartbeat();
    
    // Autenticar
    this.authenticate();
    
    // Enviar mensajes encolados
    this.flushQueue();
    
    this.emit('connection_status', {
      eventType: 'connection_status',
      payload: { status: 'connected' },
      timestamp: new Date().toISOString(),
    });
  }

  private handleClose(event: CloseEvent): void {
    this.clearTimers();
    this.isAuthenticated = false;
    
    const wasConnected = this.status === 'connected';
    this.setStatus('disconnected');

    this.emit('connection_status', {
      eventType: 'connection_status',
      payload: { 
        status: 'disconnected', 
        code: event.code, 
        reason: event.reason,
        wasClean: event.wasClean,
      },
      timestamp: new Date().toISOString(),
    });

    // Reconexión automática
    if (this.config.autoReconnect && wasConnected && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Event): void {
    this.setStatus('error');
    
    this.emit('connection_status', {
      eventType: 'connection_status',
      payload: { status: 'error', error: error.toString() },
      timestamp: new Date().toISOString(),
    });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      // Manejar mensajes de autenticación
      if (data.type === 'auth') {
        this.isAuthenticated = data.success === true;
        if (this.isAuthenticated) {
          this.flushQueue();
        }
        return;
      }

      // Emitir evento de chat
      const wsEvent: WsChatEvent = {
        eventType: data.eventType || 'message_received',
        payload: data.payload || data,
        timestamp: data.timestamp || new Date().toISOString(),
      };

      this.emit(wsEvent.eventType, wsEvent);
      this.emit('*', wsEvent); // Wildcard handler
      
    } catch (err) {
      console.error('[WsBridge] Error parsing message:', err);
    }
  }

  private authenticate(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const authPayload = {
      type: 'auth',
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      userId: this.config.userId,
      timestamp: Date.now(),
    };
    
    this.sendRaw(authPayload);
  }

  private sendRaw(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.isReady()) {
      const msg = this.messageQueue.shift();
      if (msg) this.sendRaw(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.setStatus('reconnecting');
    this.reconnectAttempts++;
    
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1),
      60000 // Max 60 seconds
    );
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Error handled in connect()
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'ping', timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: WsConnectionStatus): void {
    this.status = status;
  }

  private emit(eventType: string, event: WsChatEvent): void {
    const handlers = this.handlers.get(eventType) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[WsBridge] Handler error for ${eventType}:`, err);
      }
    }
  }
}

/**
 * Factory para crear instancias de WsBridge con configuración por defecto
 */
export function createWsBridge(config?: Partial<WsBridgeConfig>): WsBridge {
  return new WsBridge(config);
}

/**
 * Utilidad para formatear comprobante de pago para envío
 */
export function formatReceiptForWs(
  orderId: string,
  amount: number,
  bank: string,
  reference: string,
  senderName: string,
): string {
  return JSON.stringify({
    orderId,
    amount,
    bank,
    reference,
    senderName,
    timestamp: new Date().toISOString(),
    type: 'pago_movil',
  });
}