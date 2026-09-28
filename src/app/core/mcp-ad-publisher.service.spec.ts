import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpAdPublisherService } from './mcp-ad-publisher.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';
import {
  BinanceRepricerService,
  REPRICER_EXECUTION_MODES,
  unregisterRepricerPublisher,
} from './binance-repricer.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';

describe('McpAdPublisherService', () => {
  let publisherSvc: McpAdPublisherService;
  let repricerSvc: BinanceRepricerService;

  const mockToast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const mockMcp = {
    testTool: vi.fn(),
  };

  beforeEach(() => {
    mockToast.success.mockReset();
    mockToast.info.mockReset();
    mockToast.error.mockReset();
    mockMcp.testTool.mockReset();
    unregisterRepricerPublisher();

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: mockToast },
        { provide: McpService, useValue: mockMcp },
        { provide: BinanceP2pService, useValue: { fetchMarketDepth: vi.fn() } },
        { provide: AccountsService, useValue: { usages: () => [] } },
        BinanceRepricerService,
        McpAdPublisherService,
      ],
    });

    publisherSvc = injector.get(McpAdPublisherService);
    repricerSvc = injector.get(BinanceRepricerService);
  });

  afterEach(() => {
    publisherSvc.disablePublishing();
    unregisterRepricerPublisher();
  });

  it('initially leaves BinanceRepricerService in READ_ONLY mode', () => {
    expect(publisherSvc.isEnabled()).toBe(false);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
  });

  it('activates PUBLISHING mode when enablePublishing is called', () => {
    publisherSvc.enablePublishing({ dryRun: true, maxDeviationPct: 2.5 });

    expect(publisherSvc.isEnabled()).toBe(true);
    expect(publisherSvc.isDryRun()).toBe(true);
    expect(publisherSvc.maxDeviationPct()).toBe(2.5);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
    expect(repricerSvc.isPublishing()).toBe(true);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('restores READ_ONLY mode when disablePublishing is called', () => {
    publisherSvc.enablePublishing();
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);

    publisherSvc.disablePublishing();
    expect(publisherSvc.isEnabled()).toBe(false);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    expect(mockToast.info).toHaveBeenCalled();
  });

  it('dispatches publish requests to MCP publish_ad_price tool and handles success', async () => {
    publisherSvc.enablePublishing({ dryRun: false });

    mockMcp.testTool.mockResolvedValue({
      success: true,
      result: {
        success: true,
        publishedPrice: 78.5,
        auditTrail: { signature: 'SIG-AD-TEST-123' },
      },
    });

    const result = await publisherSvc.publish({
      buyPrice: 78.5,
      sellPrice: 79.5,
      strategy: 'TOP_1',
    });

    expect(result).toBe(true);
    expect(mockMcp.testTool).toHaveBeenCalledTimes(2);
    expect(publisherSvc.lastPublishedSignature()).toBe('SIG-AD-TEST-123');
    expect(publisherSvc.successfulPublishesCount()).toBe(1);
    expect(publisherSvc.lastPublishTimestamp()).not.toBeNull();
  });

  it('aborts and returns false if MCP tool reports guardrail rejection', async () => {
    publisherSvc.enablePublishing();

    mockMcp.testTool.mockResolvedValue({
      success: true,
      result: {
        success: false,
        error: 'DESVÍO PELIGROSO RECHAZADO',
      },
    });

    const result = await publisherSvc.publish({
      buyPrice: 90.0,
      sellPrice: 0,
      strategy: 'TOP_1',
    });

    expect(result).toBe(false);
    expect(publisherSvc.lastRejectionError()).toContain('DESVÍO PELIGROSO RECHAZADO');
    expect(mockToast.error).toHaveBeenCalled();
  });
});
