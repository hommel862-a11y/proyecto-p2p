import { Injectable, signal, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import type { InboundReceiptEvent } from '@p2p/core';

export type GatewayConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

@Injectable({ providedIn: 'root' })
export class InboundGatewayService implements OnDestroy {
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private baseUrl = 'http://127.0.0.1:3030';
  private autoReconnect = true;

  // Reactive state signals
  readonly status = signal<GatewayConnectionStatus>('DISCONNECTED');
  readonly lastReceipt = signal<InboundReceiptEvent | null>(null);
  readonly totalReceiptsReceived = signal<number>(0);
  readonly lastError = signal<string | null>(null);

  // Observable stream for event consumers
  private readonly receiptSubject = new Subject<InboundReceiptEvent>();
  readonly receipt$: Observable<InboundReceiptEvent> = this.receiptSubject.asObservable();

  constructor() {
    // Graceful startup connection if in browser/electron runtime
    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      this.connect();
    }
  }

  setGatewayUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed && trimmed !== this.baseUrl) {
      this.baseUrl = trimmed;
      if (this.status() === 'CONNECTED' || this.status() === 'CONNECTING') {
        this.disconnect();
        this.connect();
      }
    }
  }

  getGatewayUrl(): string {
    return this.baseUrl;
  }

  connect(): void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    if (this.eventSource) {
      this.disconnect();
    }

    this.autoReconnect = true;
    this.status.set('CONNECTING');
    this.lastError.set(null);

    try {
      const sseUrl = `${this.baseUrl}/api/events`;
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        this.status.set('CONNECTED');
        this.reconnectAttempts = 0;
        this.lastError.set(null);
      };

      this.eventSource.addEventListener('new_receipt', (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as InboundReceiptEvent;
          if (parsed && parsed.eventId && parsed.parsed) {
            this.lastReceipt.set(parsed);
            this.totalReceiptsReceived.update((n) => n + 1);
            this.receiptSubject.next(parsed);
          }
        } catch (err) {
          console.warn('[InboundGatewayService] Error parsing incoming receipt event:', err);
        }
      });

      this.eventSource.onerror = () => {
        this.status.set('DISCONNECTED');
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        if (this.autoReconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.status.set('DISCONNECTED');
      this.lastError.set(message);
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.status.set('DISCONNECTED');
  }

  /**
   * Pulls any pending unconsumed receipts currently buffered in the gateway memory.
   */
  async fetchPendingReceipts(): Promise<InboundReceiptEvent[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/events/pending`);
      if (!res.ok) {
        return [];
      }
      const data = (await res.json()) as { count?: number; events?: InboundReceiptEvent[] };
      return Array.isArray(data.events) ? data.events : [];
    } catch {
      return [];
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    // Exponential backoff: 3s, 6s, 12s, max 30s
    const delayMs = Math.min(3000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.receiptSubject.complete();
  }
}
