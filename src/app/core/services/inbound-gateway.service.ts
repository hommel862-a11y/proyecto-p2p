import { Injectable, signal, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import type {
  InboundReceiptEvent,
  ArmOutboxSseEvent,
  ArmWorkspaceId,
  ArmApprovalStatus,
  ArmToolExecutionResult,
} from '@p2p/core';

export type GatewayConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export const GATEWAY_STORAGE_MODES = {
  POSTGRES: 'POSTGRES',
  MEMORY_FALLBACK: 'MEMORY_FALLBACK',
} as const;

export type GatewayStorageMode =
  (typeof GATEWAY_STORAGE_MODES)[keyof typeof GATEWAY_STORAGE_MODES];

export interface GatewayStorageHealth {
  ok: boolean;
  mode: GatewayStorageMode | string;
  postgresConnected: boolean;
  rlsActive: boolean;
  pgvectorAvailable?: boolean;
}

export interface VerifyGatewayReceiptPayload {
  workspaceId: ArmWorkspaceId;
  bankRailId: string;
  referenceCode: string;
  amountFiat?: number;
  dealId?: string | null;
}

export interface VerifyGatewayReceiptResult {
  ok: boolean;
  verified: boolean;
  recorded: boolean;
  collision: boolean;
  existingDealId?: string | null;
  mode?: GatewayStorageMode | string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class InboundGatewayService implements OnDestroy {
  private static readonly STORAGE_HEALTH_FALLBACK: GatewayStorageHealth = {
    ok: false,
    mode: GATEWAY_STORAGE_MODES.MEMORY_FALLBACK,
    postgresConnected: false,
    rlsActive: false,
  };

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private baseUrl = 'http://127.0.0.1:3030';
  private autoReconnect = true;

  // Reactive state signals
  readonly status = signal<GatewayConnectionStatus>('DISCONNECTED');
  readonly lastReceipt = signal<InboundReceiptEvent | null>(null);
  readonly totalReceiptsReceived = signal<number>(0);
  readonly lastOutboxEventId = signal<number>(0);
  readonly lastArmEvent = signal<ArmOutboxSseEvent | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly storageHealth = signal<GatewayStorageHealth | null>(null);

  // Observable stream for event consumers
  private readonly receiptSubject = new Subject<InboundReceiptEvent>();
  readonly receipt$: Observable<InboundReceiptEvent> = this.receiptSubject.asObservable();

  private readonly armEventSubject = new Subject<ArmOutboxSseEvent>();
  readonly armEvent$: Observable<ArmOutboxSseEvent> = this.armEventSubject.asObservable();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('p2p.inbound.gateway_url');
        if (stored) {
          this.baseUrl = stored.trim().replace(/\/+$/, '');
        }
      } catch {
        /* storage fallback */
      }
      if (typeof EventSource !== 'undefined') {
        this.connect();
      }
    }
  }

  setGatewayUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed) {
      this.baseUrl = trimmed;
      try {
        localStorage.setItem('p2p.inbound.gateway_url', trimmed);
      } catch {
        /* storage fallback */
      }
      if (this.status() === 'CONNECTED' || this.status() === 'CONNECTING') {
        this.disconnect();
      }
      this.connect();
    }
  }

  getGatewayUrl(): string {
    return this.baseUrl;
  }

  async testConnection(targetUrl?: string): Promise<{ ok: boolean; status?: string; error?: string }> {
    const url = (targetUrl || this.baseUrl).trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(4000) });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { status?: string };
      return { ok: true, status: data.status || 'UP' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de conexión';
      return { ok: false, error: msg };
    }
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
      const cursor = this.lastOutboxEventId();
      const sseUrl =
        cursor > 0 ? `${this.baseUrl}/api/events?lastEventId=${cursor}` : `${this.baseUrl}/api/events`;
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

      this.eventSource.addEventListener('arm_event', (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as ArmOutboxSseEvent;
          if (parsed && typeof parsed.id === 'number' && parsed.workspaceId) {
            this.lastOutboxEventId.set(Math.max(this.lastOutboxEventId(), parsed.id));
            this.lastArmEvent.set(parsed);
            this.armEventSubject.next(parsed);
          }
        } catch (err) {
          console.warn('[InboundGatewayService] Error parsing incoming ARM event:', err);
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

  async executeArmTool(params: {
    workspaceId: ArmWorkspaceId;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<ArmToolExecutionResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/arm/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as ArmToolExecutionResult;
    } catch {
      return null;
    }
  }

  async resolveArmApproval(params: {
    workspaceId: ArmWorkspaceId;
    approvalId: string;
    decision: ArmApprovalStatus;
    approvedText?: string;
    saveAsExample?: boolean;
  }): Promise<{ success: boolean; outboxEventId?: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/arm/approvals/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) return null;
      return (await res.json()) as { success: boolean; outboxEventId?: number };
    } catch {
      return null;
    }
  }

  /**
   * Queries gateway PostgreSQL / RLS / pgvector storage health with safe memory-fallback state on network failure.
   */
  async fetchStorageHealth(targetUrl?: string): Promise<GatewayStorageHealth> {
    const url = (targetUrl || this.baseUrl).trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${url}/api/arm/health/storage`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        const fallback = { ...InboundGatewayService.STORAGE_HEALTH_FALLBACK };
        this.storageHealth.set(fallback);
        return fallback;
      }

      const data = (await res.json()) as Partial<GatewayStorageHealth>;
      const health: GatewayStorageHealth = {
        ok: data.ok ?? true,
        mode:
          data.mode ??
          (data.postgresConnected
            ? GATEWAY_STORAGE_MODES.POSTGRES
            : GATEWAY_STORAGE_MODES.MEMORY_FALLBACK),
        postgresConnected: Boolean(data.postgresConnected),
        rlsActive: Boolean(data.rlsActive),
        ...(typeof data.pgvectorAvailable === 'boolean'
          ? { pgvectorAvailable: data.pgvectorAvailable }
          : {}),
      };
      this.storageHealth.set(health);
      return health;
    } catch {
      const fallback = { ...InboundGatewayService.STORAGE_HEALTH_FALLBACK };
      this.storageHealth.set(fallback);
      return fallback;
    }
  }

  /**
   * Verifies a payment reference against the gateway anti-replay ledger with safe error handling.
   */
  async verifyReceiptWithGateway(
    payload: VerifyGatewayReceiptPayload,
  ): Promise<VerifyGatewayReceiptResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/arm/receipts/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });

      let data: Partial<VerifyGatewayReceiptResult> | null = null;
      try {
        data = (await res.json()) as Partial<VerifyGatewayReceiptResult>;
      } catch {
        data = null;
      }

      if (!res.ok) {
        const collision = Boolean(data?.collision);
        return {
          ok: false,
          verified: false,
          recorded: false,
          collision,
          ...(collision ? { existingDealId: data?.existingDealId ?? null } : {}),
          ...(data?.mode ? { mode: data.mode } : {}),
          error: data?.error || `HTTP ${res.status}`,
        };
      }

      const collision = Boolean(data?.collision);
      return {
        ok: data?.ok ?? !collision,
        verified: data?.verified ?? !collision,
        recorded: data?.recorded ?? !collision,
        collision,
        existingDealId: data?.existingDealId ?? null,
        ...(data?.mode ? { mode: data.mode } : {}),
        ...(data?.error ? { error: data.error } : {}),
      };
    } catch (err: unknown) {
      return {
        ok: false,
        verified: false,
        recorded: false,
        collision: false,
        error: err instanceof Error ? err.message : 'Error de conexión',
      };
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
