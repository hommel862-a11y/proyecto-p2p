import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
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

    TestBed.configureTestingModule({
      providers: [InboundGatewayService],
    });

    service = TestBed.inject(InboundGatewayService);
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
});
