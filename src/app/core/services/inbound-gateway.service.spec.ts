import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InboundGatewayService } from './inbound-gateway.service';
import type { InboundReceiptEvent } from '@p2p/core';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: MessageEvent) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: string, data: unknown): void {
    const handlers = this.listeners[event] || [];
    const messageEvent = { data: JSON.stringify(data) } as MessageEvent;
    for (const h of handlers) {
      h(messageEvent);
    }
  }
}

describe('InboundGatewayService', () => {
  let service: InboundGatewayService;
  let originalEventSource: any;

  beforeEach(() => {
    MockEventSource.instances = [];
    originalEventSource = (globalThis as any).EventSource;
    (globalThis as any).EventSource = MockEventSource;

    service = new InboundGatewayService();
  });

  afterEach(() => {
    service.disconnect();
    (globalThis as any).EventSource = originalEventSource;
  });

  it('initializes and connects to the default gateway SSE endpoint', () => {
    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    const instance = MockEventSource.instances[0];
    expect(instance.url).toBe('http://127.0.0.1:3030/api/events');
    expect(service.status()).toBe('CONNECTING');

    // Simulate connection established
    instance.onopen?.();
    expect(service.status()).toBe('CONNECTED');
    expect(service.lastError()).toBeNull();
  });

  it('receives incoming receipt events and updates reactive signals and streams', () => {
    const instance = MockEventSource.instances[0];
    instance.onopen?.();

    const sampleReceipt: InboundReceiptEvent = {
      eventId: 'evt-test-999',
      channel: 'WHATSAPP',
      sender: { id: '584149999999', name: 'Desk Trader', channel: 'WHATSAPP' },
      parsed: {
        rawText: 'Banesco Ref: 88776655 por Bs. 25000',
        referenceId: '88776655',
        amountFiat: 25000,
        currency: 'VES',
        detectedBank: 'Banesco',
      },
      scope: 'P2P_DESK',
      receivedAt: Date.now(),
      rawText: 'Banesco Ref: 88776655 por Bs. 25000',
      status: 'AUTO_MATCHED',
    };

    let receivedFromStream: InboundReceiptEvent | null = null;
    const sub = service.receipt$.subscribe((evt) => {
      receivedFromStream = evt;
    });

    instance.emit('new_receipt', sampleReceipt);

    expect(service.lastReceipt()).toEqual(sampleReceipt);
    expect(service.totalReceiptsReceived()).toBe(1);
    expect(receivedFromStream).toEqual(sampleReceipt);

    sub.unsubscribe();
  });

  it('updates connection state on error and disconnects cleanly', () => {
    const instance = MockEventSource.instances[0];
    instance.onerror?.();

    expect(service.status()).toBe('DISCONNECTED');
    expect(instance.closed).toBe(true);

    service.disconnect();
    expect(service.status()).toBe('DISCONNECTED');
  });

  it('allows dynamic gateway URL configuration', () => {
    service.setGatewayUrl('http://192.168.1.50:4000/');
    expect(service.getGatewayUrl()).toBe('http://192.168.1.50:4000');
  });

  it('handles fetchPendingReceipts network fallback gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network down'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    const receipts = await service.fetchPendingReceipts();
    expect(receipts).toEqual([]);

    globalThis.fetch = originalFetch;
  });

  it('tracks ARM outbox event IDs and passes lastEventId cursor on reconnect', () => {
    const instance = MockEventSource.instances[0];
    instance.onopen?.();

    instance.emit('arm_event', {
      id: 42,
      workspaceId: 'ARM_B2B',
      eventType: 'pipeline_transition',
      aggregateId: 'lead-1',
      payload: { toStageSlug: 'calificado' },
      timestamp: Date.now(),
    });

    expect(service.lastOutboxEventId()).toBe(42);
    expect(service.lastArmEvent()?.workspaceId).toBe('ARM_B2B');

    service.connect();
    const reconnected = MockEventSource.instances[MockEventSource.instances.length - 1];
    expect(reconnected.url).toBe('http://127.0.0.1:3030/api/events?lastEventId=42');
  });

  it('calls executeArmTool and resolveArmApproval over REST (T8)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true, outboxEventId: 99 }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const toolRes = await service.executeArmTool({
      workspaceId: 'ARM_B2B',
      toolName: 'transition_pipeline_stage',
      args: { to_stage_slug: 'calificado', reasoning: 'Score >= 70' },
    });
    expect(toolRes?.ok).toBe(true);

    const resolveRes = await service.resolveArmApproval({
      workspaceId: 'ARM_B2B',
      approvalId: 'app-1',
      decision: 'APPROVED',
    });
    expect(resolveRes?.success).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it('fetches storage health and falls back safely when gateway is unreachable', async () => {
    const originalFetch = globalThis.fetch;

    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        mode: 'POSTGRES',
        postgresConnected: true,
        rlsActive: true,
        pgvectorAvailable: true,
      }),
    });
    globalThis.fetch = okFetch as unknown as typeof fetch;

    const healthy = await service.fetchStorageHealth();
    expect(okFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/api/arm/health/storage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(healthy).toEqual({
      ok: true,
      mode: 'POSTGRES',
      postgresConnected: true,
      rlsActive: true,
      pgvectorAvailable: true,
    });

    const pgvFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        mode: 'POSTGRES_PGVECTOR',
        postgresConnected: true,
        rlsActive: true,
      }),
    });
    globalThis.fetch = pgvFetch as unknown as typeof fetch;

    const pgvHealth = await service.fetchStorageHealth();
    expect(pgvHealth.mode).toBe('POSTGRES_PGVECTOR');
    expect(pgvHealth.pgvectorAvailable).toBe(true);

    const failingFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const fallback = await service.fetchStorageHealth();
    expect(fallback).toEqual({
      ok: false,
      mode: 'MEMORY_FALLBACK',
      postgresConnected: false,
      rlsActive: false,
    });

    globalThis.fetch = originalFetch;
  });

  it('verifies payment receipts with the gateway and handles collisions and network errors safely', async () => {
    const originalFetch = globalThis.fetch;
    const payload = {
      workspaceId: 'P2P_DESK' as const,
      bankRailId: 'rail-banesco-1',
      referenceCode: '88776655',
      amountFiat: 25000,
      dealId: 'DEAL-55',
    };

    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        verified: true,
        recorded: true,
        collision: false,
        mode: 'POSTGRES',
      }),
    });
    globalThis.fetch = okFetch as unknown as typeof fetch;

    const verified = await service.verifyReceiptWithGateway(payload);
    expect(okFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/api/arm/receipts/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(verified).toEqual({
      ok: true,
      verified: true,
      recorded: true,
      collision: false,
      existingDealId: null,
      mode: 'POSTGRES',
    });

    const conflictFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        recorded: false,
        collision: true,
        existingDealId: 'DEAL-10',
        error: 'DUPLICATE_RECEIPT',
      }),
    });
    globalThis.fetch = conflictFetch as unknown as typeof fetch;

    const collision = await service.verifyReceiptWithGateway(payload);
    expect(collision.ok).toBe(false);
    expect(collision.collision).toBe(true);
    expect(collision.recorded).toBe(false);
    expect(collision.existingDealId).toBe('DEAL-10');

    const backendKeyConflictFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        recorded: false,
        collision: true,
        existingReceiptId: 'rcpt-pg-99',
        error: 'DUPLICATE_RECEIPT',
      }),
    });
    globalThis.fetch = backendKeyConflictFetch as unknown as typeof fetch;

    const backendCollision = await service.verifyReceiptWithGateway(payload);
    expect(backendCollision.existingDealId).toBe('rcpt-pg-99');

    const networkErrorFetch = vi.fn().mockRejectedValue(new Error('Gateway timeout'));
    globalThis.fetch = networkErrorFetch as unknown as typeof fetch;

    const failed = await service.verifyReceiptWithGateway(payload);
    expect(failed.ok).toBe(false);
    expect(failed.collision).toBe(false);
    expect(failed.error).toBe('Gateway timeout');

    globalThis.fetch = originalFetch;
  });

  it('attaches Bearer Authorization header to REST calls and ?token= to SSE when auth token is configured', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: 'POSTGRES_PGVECTOR',
        postgresConnected: true,
        rlsActive: true,
        pgvectorAvailable: true,
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      service.setAuthToken('my-gateway-token');
      expect(service.getAuthToken()).toBe('my-gateway-token');
      expect(service.hasAuthToken()).toBe(true);

      const latestSse = MockEventSource.instances[MockEventSource.instances.length - 1];
      expect(latestSse.url).toBe('http://127.0.0.1:3030/api/events?token=my-gateway-token');

      await service.fetchStorageHealth();
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer my-gateway-token',
      );

      service.setAuthToken('');
      expect(service.hasAuthToken()).toBe(false);
      const clearedSse = MockEventSource.instances[MockEventSource.instances.length - 1];
      expect(clearedSse.url).toBe('http://127.0.0.1:3030/api/events');
    } finally {
      service.setAuthToken('');
      globalThis.fetch = originalFetch;
    }
  });
});
