import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceFillsService } from './binance-fills.service';
import {
  DecisionJournalService,
  type DecisionJournalOp,
  type DecisionJournalBridge,
} from './decision-journal.service';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import {
  InMemoryDecisionJournalRepository,
  realizedCycleFigures,
  type RecordOutcomeInput,
  type CloseDecisionCycleInput,
  type OpenDecisionCycleInput,
  type RecordMarketSnapshotInput,
  type RecordDecisionInput,
} from '@p2p/core';

describe('Binance Fills -> Decision Journal Integration (T6)', () => {
  let fillsService: BinanceFillsService;
  let journalService: DecisionJournalService;
  let repo: InMemoryDecisionJournalRepository;

  beforeEach(() => {
    repo = new InMemoryDecisionJournalRepository();

    const inMemoryBridge: DecisionJournalBridge = {
      invoke: async (op: DecisionJournalOp, payload?: unknown) => {
        switch (op) {
          case 'appendMarketSnapshot':
            return repo.appendMarketSnapshot(payload as RecordMarketSnapshotInput);
          case 'openCycle':
            return repo.openCycle(payload as OpenDecisionCycleInput);
          case 'closeCycle': {
            const { cycleId, input } = payload as { cycleId: string; input: CloseDecisionCycleInput };
            return repo.closeCycle(cycleId, input);
          }
          case 'getCycle':
            return repo.getCycle(payload as string);
          case 'listCycles':
            return repo.listCycles(payload as any);
          case 'appendDecision':
            return repo.appendDecision(payload as RecordDecisionInput);
          case 'getDecision':
            return repo.getDecision(payload as number);
          case 'listDecisionsByCycle':
            return repo.listDecisionsByCycle(payload as string);
          case 'appendOutcome':
            return repo.appendOutcome(payload as RecordOutcomeInput);
          case 'listOutcomesByDecision':
            return repo.listOutcomesByDecision(payload as number);
          case 'getDecisionPerformance':
            return repo.getDecisionPerformance(payload as any);
          case 'getVerificationSummary':
            return repo.getVerificationSummary(payload as any);
          default:
            throw new Error(`Unsupported op: ${op}`);
        }
      },
    };

    (globalThis as { p2p?: { decisionJournal?: DecisionJournalBridge } }).p2p = {
      decisionJournal: inMemoryBridge,
    };

    const mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    const mockCredentials = {
      getBinanceCredentials: vi.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's' }),
    };

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: mockToast },
        { provide: CredentialStoreService, useValue: mockCredentials },
        DecisionJournalService,
        BinanceFillsService,
      ],
    });

    journalService = injector.get(DecisionJournalService);
    fillsService = injector.get(BinanceFillsService);
  });

  it('completes the full loop: opens cycle, records decision, ingests CSV fills, calculates realized figures, and closes cycle honestly as CLOSED', async () => {
    // 1. Open an accounting cycle
    const cycle = await journalService.openCycle({
      origin: 'OPERATOR',
      capitalReservedUsdt: 1000,
      title: 'Sesión P2P Vespertino',
    });
    expect(cycle.status).toBe('OPEN');

    // 2. Record a market snapshot
    const now = Date.now();
    const snapshot = await journalService.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 88.5,
      askUsd: 89.8,
      nBids: 10,
      nAsks: 10,
      stale: false,
      fetchedAt: now,
    });

    // 3. Record a decision taken by the engine
    const decision = await journalService.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 88.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1.5,
      reason: 'Top maker bid pricing',
      safetyFlags: [],
    });
    expect(decision.id).toBeGreaterThan(0);

    // Initial check: without fills, realizedCycleFigures must be null
    const initialOutcomes = await journalService.listOutcomesByDecision(decision.id);
    expect(realizedCycleFigures(initialOutcomes)).toBeNull();

    // 4. Ingest real Binance CSV fill matching this decision
    const csvData = `Order Number,Order Type,Asset Type,Fiat Type,Total Price,Unit Price,Quantity,Order Status,Created Time,Counterparty
BINANCE-ORDER-8899,BUY,USDT,VES,44250.00,88.50,500.00,COMPLETED,${new Date(now + 120_000).toISOString()},ClienteVerificado`;

    const summary = await fillsService.importCsv(csvData, cycle.id);
    expect(summary.recordedCount).toBe(1);

    // 5. Verify the outcome in the journal
    const recordedOutcomes = await journalService.listOutcomesByDecision(decision.id);
    expect(recordedOutcomes).toHaveLength(1);
    expect(recordedOutcomes[0].externalRef).toBe('BINANCE-ORDER-8899');
    expect(recordedOutcomes[0].filledAmountUsdt).toBe(500);
    expect(recordedOutcomes[0].filledPrice).toBe(88.5);

    // 6. Verify realizedCycleFigures now returns valid, proven figures
    const figures = realizedCycleFigures(recordedOutcomes);
    expect(figures).not.toBeNull();
    expect(figures!.realizedProfitUsdt).toBe(7.5); // 500 * 1.5% = 7.5 USDT
    expect(figures!.realizedSpreadPct).toBe(1.5);

    // 7. Close the cycle honestly as CLOSED with computed figures
    const closed = await journalService.closeCycle(cycle.id, {
      status: 'CLOSED',
      closeReason: 'Ciclo completado y conciliado con fills reales de Binance P2P.',
      realizedProfitUsdt: figures!.realizedProfitUsdt,
      realizedSpreadPct: figures!.realizedSpreadPct,
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedProfitUsdt).toBe(7.5);
    expect(closed.realizedSpreadPct).toBe(1.5);
    expect(closed.closeReason).toContain('conciliado con fills reales');
  });
});
